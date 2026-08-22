import type { SceneArtboard, SceneClip, SceneDoc, SceneTrack } from "@motion-mcp/scene-graph";
import { flattenSvgNodes, parseSvgDocument } from "@motion-mcp/svg-parser";
import type { SvgNodeInfo } from "@motion-mcp/shared-types";
import { partTokens, tokensMatch } from "./match.js";

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "idle";
}

export interface AnimatedSvgOptions {
  artboardId?: string;
  /** Which state's clip to bake in. Defaults to the machine's initial state. */
  state?: string;
}

/**
 * Bakes one SceneClip into a self-contained animated SVG (CSS @keyframes).
 * Deterministic: identical inputs produce byte-identical output.
 */
export function toAnimatedSvg(doc: SceneDoc, options: AnimatedSvgOptions = {}): string {
  const artboard = pickArtboard(doc, options.artboardId);
  const source = artboardSource(artboard);
  const parsed = parseSvgDocument(source);
  if (parsed.roots.length === 0) throw new Error("artboard sourceSvg has no parseable root");

  const clip = pickClip(artboard, options.state);
  const root = parsed.roots[0]!;
  const flat = flattenSvgNodes(root);

  interface PartBinding {
    selectorAttr: "id" | "data-motion-part";
    selectorValue: string;
    tracks: SceneTrack[];
    isRoot: boolean;
  }

  const bindings: PartBinding[] = [];
  let autoPart = 0;
  for (const track of clip.tracks) {
    if (track.keys.length < 2) continue;
    if (track.targetPart === "*") {
      bindings.push({ selectorAttr: "data-motion-part", selectorValue: "root", tracks: [track], isRoot: true });
      continue;
    }
    const matches = flat.filter((node) => tokensMatch(track.targetPart, partTokens(node)));
    for (const node of matches.slice(0, 8)) {
      const existing = bindings.find((binding) => !binding.isRoot && binding.selectorValue === node.nodeId);
      if (existing) {
        existing.tracks.push(track);
      } else {
        autoPart += 1;
        bindings.push({
          selectorAttr: node.attrs.id ? "id" : "data-motion-part",
          selectorValue: node.attrs.id ?? `part-${autoPart}`,
          tracks: [track],
          isRoot: false
        });
      }
    }
  }

  // Tag nodes that need a generated data-motion-part
  const tagCounter = { value: 0 };
  for (const node of flat) {
    const binding = bindings.find(
      (candidate) => candidate.selectorAttr === "data-motion-part" && candidate.selectorValue === node.nodeId
    );
    if (binding && !node.attrs.id) {
      const assigned = `mcp-${++tagCounter.value}`;
      binding.selectorValue = assigned;
      node.attrs["data-motion-part"] = assigned;
    }
  }

  const keyframeBlocks: string[] = [];
  const animationRules: string[] = [];

  bindings.forEach((binding, index) => {
    const transformTracks = binding.tracks.filter((track) => isTransform(track.property));
    const paintTracks = binding.tracks.filter((track) => !isTransform(track.property));
    const animations: string[] = [];

    if (transformTracks.length > 0) {
      const name = `mcp-t${index}`;
      keyframeBlocks.push(transformKeyframes(name, transformTracks, clip.durationMs));
      animations.push(`${name} ${ms(clip.durationMs)} ${timingFor(binding.tracks)} ${iteration(clip)} both`);
    }
    for (const track of paintTracks) {
      const name = `mcp-p${index}-${sanitizeProperty(track.property)}`;
      keyframeBlocks.push(paintKeyframes(name, track, clip.durationMs));
      animations.push(`${name} ${ms(clip.durationMs)} ${timingFor([track])} ${iteration(clip)} both`);
    }

    if (animations.length === 0) return;
    const selector = binding.isRoot
      ? "svg > g[data-motion-root]"
      : binding.selectorAttr === "id"
        ? `#${binding.selectorValue}`
        : `[data-motion-part="${binding.selectorValue}"]`;
    animationRules.push(`${selector} { animation: ${animations.join(", ")}; }`);
  });

  // Wrap children in the root motion group so "*" tracks have an anchor.
  const inner = root.children.map((child) => serialize(child)).join("");
  const rootAttrs = Object.entries(root.attrs)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(" ");
  void root;

  return `<svg ${rootAttrs}>
<style>
${keyframeBlocks.join("\n")}
@media (prefers-reduced-motion: reduce) {
  svg * { animation: none !important; }
}
${animationRules.join("\n")}
</style>
<g data-motion-root>${inner}</g>
</svg>
`;
}

function transformKeyframes(name: string, tracks: SceneTrack[], durationMs: number): string {
  const times = unionTimes(tracks);
  const stops = times.map((t) => {
    const parts: string[] = [];
    const tx = sampleProp(tracks, "translateX", t) ?? sampleProp(tracks, "x", t);
    const ty = sampleProp(tracks, "translateY", t) ?? sampleProp(tracks, "y", t);
    const scale = sampleProp(tracks, "scale", t);
    const rotate = sampleProp(tracks, "rotate", t);
    if ((tx ?? 0) !== 0 || (ty ?? 0) !== 0) parts.push(`translate(${num(tx ?? 0)}px, ${num(ty ?? 0)}px)`);
    if (rotate) parts.push(`rotate(${num(rotate)}deg)`);
    if (scale !== undefined && scale !== 1) parts.push(`scale(${num(scale)})`);
    if (parts.length === 0) parts.push("none");
    return `  ${percent(t, durationMs)} { transform: ${parts.join(" ")}; }`;
  });
  return `@keyframes ${name} {\n${stops.join("\n")}\n}`;
}

function paintKeyframes(name: string, track: SceneTrack, durationMs: number): string {
  const property = track.property;
  const cssProperty = property === "strokeWidth" ? "stroke-width" : property;
  const stops = track.keys.map((key) =>
    `  ${percent(key.t, durationMs)} { ${cssProperty}: ${cssValue(key.value)}; }`
  );
  return `@keyframes ${name} {\n${stops.join("\n")}\n}`;
}

function unionTimes(tracks: SceneTrack[]): number[] {
  const set = new Set<number>();
  for (const track of tracks) for (const key of track.keys) set.add(key.t);
  return [...set].sort((a, b) => a - b);
}

function sampleProp(tracks: SceneTrack[], property: string, t: number): number | undefined {
  const track = tracks.find((candidate) => candidate.property === property);
  if (!track) return undefined;
  const keys = track.keys;
  if (keys.length === 0) return undefined;
  if (t <= keys[0]!.t) return asNumber(keys[0]!.value);
  if (t >= keys[keys.length - 1]!.t) return asNumber(keys[keys.length - 1]!.value);
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const k0 = keys[lo]!;
  const k1 = keys[hi]!;
  const u = (t - k0.t) / Math.max(k1.t - k0.t, 1e-6);
  return asNumber(k0.value) + (asNumber(k1.value) - asNumber(k0.value)) * u;
}

function timingFor(tracks: SceneTrack[]): string {
  const easings = new Set<string>();
  for (const track of tracks) {
    for (const key of track.keys.slice(1)) easings.add(key.easing ?? "linear");
  }
  if (easings.size === 1) return CSS_EASING[easings.values().next().value!] ?? "linear";
  return "ease-in-out";
}

const CSS_EASING: Record<string, string> = {
  linear: "linear",
  easeIn: "cubic-bezier(0.42, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.58, 1)",
  easeInOut: "cubic-bezier(0.42, 0, 0.58, 1)",
  spring: "cubic-bezier(0, 0, 0.58, 1)",
  hold: "step-end"
};

function isTransform(property: string): boolean {
  return ["translateX", "translateY", "x", "y", "scale", "scaleX", "scaleY", "rotate"].includes(property);
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by lottie.ts)
// ---------------------------------------------------------------------------

export function pickArtboard(doc: SceneDoc, artboardId?: string): SceneArtboard {
  const artboard = artboardId
    ? doc.artboards.find((candidate) => candidate.artboardId === artboardId)
    : doc.artboards[0];
  if (!artboard) throw new Error(`artboard ${artboardId ?? "(first)"} not found`);
  return artboard;
}

export function artboardSource(artboard: SceneArtboard): string {
  const source = (artboard as { sourceSvg?: string }).sourceSvg;
  if (!source) {
    throw new Error(
      `artboard ${artboard.artboardId} has no sourceSvg. Attach the SVG source to the artboard before exporting.`
    );
  }
  return source;
}

export function pickClip(artboard: SceneArtboard, stateName?: string): SceneClip {
  const machine = artboard.stateMachines[0];
  if (!machine) throw new Error(`artboard ${artboard.artboardId} has no state machines`);
  const target = stateName ? normalize(stateName) : normalize(machine.states.find((state) => state.stateId === machine.initialStateId)?.name ?? "idle");
  const state = machine.states.find((candidate) => normalize(candidate.name) === target);
  if (!state?.clipId || !artboard.clips[state.clipId]) {
    throw new Error(`state "${stateName ?? target}" has no compiled clip`);
  }
  return artboard.clips[state.clipId];
}

export function serialize(node: SvgNodeInfo): string {
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`)
    .join(" ");
  const open = `<${node.tag}${attrs ? ` ${attrs}` : ""}`;
  if (node.textContent) return `${open}>${escapeText(node.textContent)}</${node.tag}>`;
  if (node.children.length === 0) return `${open}/>`;
  return `${open}>${node.children.map(serialize).join("")}</${node.tag}>`;
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function percent(t: number, durationMs: number): string {
  return `${Math.round((t / Math.max(durationMs, 1)) * 10000) / 100}%`;
}

function ms(duration: number): string {
  return `${round(duration)}ms`;
}

function iteration(clip: SceneClip): string {
  return clip.loop ? "infinite" : "1";
}

function sanitizeProperty(property: string): string {
  return property.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cssValue(value: number | string | number[]): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(num).join(" ");
  return String(num(value));
}

function num(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round(value: number): number {
  return Math.round(value);
}

function asNumber(value: number | string | number[] | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (Array.isArray(value)) return value[0] ?? 0;
  return 0;
}
