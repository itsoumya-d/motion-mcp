import { promises as fs } from "node:fs";
import path from "node:path";
import { buildMotionCurves } from "@motion-mcp/vectorizer";
import type { TrackedPart } from "@motion-mcp/vectorizer";
import { flattenSvgNodes, parseSvgDimensions, parseSvgTree } from "@motion-mcp/svg-parser";
import type { AssetInfo, FileChange } from "@motion-mcp/shared-types";
import { nowIso, stableId } from "@motion-mcp/shared-types";
import type { SceneTrack } from "@motion-mcp/scene-graph";
import { toUnifiedDiff, upsertIndexedAsset, writeDiff } from "./internals.js";

export type MotionCurveEasing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold" | "spring";

export interface MotionCurvesToolInput {
  /** Tracked part trajectories, e.g. from `trackPartsAcrossFrames` after `vectorize_video`. */
  parts: TrackedPart[];
  /**
   * SVG fragment with persistent `<g id="part-id">` layers (one per part).
   * When omitted, the staged asset carries tracks only (geometry-less motion).
   */
  partsSvg?: string;
  /** Human-readable provenance label used in filenames and summaries. */
  sourceLabel?: string;
  /** Segment easing applied between samples. Default "easeInOut". */
  easing?: MotionCurveEasing;
}

export interface MotionCurvesToolResult {
  ok: boolean;
  diffId: string;
  assetId: string;
  assetPath: string;
  scenePath: string;
  trackCount: number;
  animatedParts: number;
  durationMs: number;
  /** Flat view of the staged eased tracks (t/value pairs for receipts). */
  tracks: Array<{ targetPart: string; property: string; keys: Array<{ t: number; value: number }> }>;
  previewUrl: string;
  nextTools: string[];
}

const EASE_TO_CSS: Record<MotionCurveEasing, string> = {
  linear: "linear",
  easeIn: "ease-in",
  easeOut: "ease-out",
  easeInOut: "ease-in-out",
  hold: "steps(1, end)",
  // Single spring approximation; SceneDoc keeps the semantic name.
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)"
};

/**
 * Motion-to-curves as a reviewable staged diff: tracked part trajectories
 * become an indexed, playable vector asset whose SceneDoc carries eased
 * translateX/translateY tracks over persistent per-part layers, plus a
 * standalone SVG (CSS keyframes mirror the tracks) for direct preview.
 *
 * Mirrors vectorizeVideoAsset's staging contract: artifact files under
 * .motion-mcp/generated-assets + .motion-mcp/motion-curves, an indexed
 * asset, and a diff that applies only after approval. Deterministic per
 * (parts, easing); throws on degenerate input instead of staging an empty clip.
 */
export async function motionCurvesFromTracks(
  root: string,
  input: MotionCurvesToolInput
): Promise<MotionCurvesToolResult> {
  const curves = buildMotionCurves(input.parts, { easing: input.easing });
  if (curves.tracks.length === 0) {
    throw new Error(
      "motion_to_curves needs at least one tracked part with observed motion; " +
      "run vectorize_video (or rig_asset) first."
    );
  }
  const sourceLabel = input.sourceLabel ?? "tracked-motion";

  const doc = structuredClone(curves.doc);
  const artboard = doc.artboards[0]!;
  // Persistent layers: one per geometry-bearing tracked part, stable order.
  const layeredParts = [...input.parts]
    .filter((part) => part.frames.some((frame) => frame.loop !== undefined))
    .sort((a, b) => (a.partId < b.partId ? -1 : 1));
  artboard.layers = layeredParts.map((part, index) => ({
    layerId: part.partId,
    name: part.label || part.partId,
    order: index,
    targetParts: [part.partId]
  }));
  artboard.stateMachines = [
    {
      stateMachineId: "motion-curves:machine",
      name: "MotionCurves",
      initialStateId: "state-play",
      states: [
        {
          stateId: "state-play",
          name: "play",
          kind: "entry" as const,
          clipId: "clip-play",
          loop: true,
          controlledParts: artboard.layers.map((layer) => layer.layerId)
        }
      ],
      transitions: []
    }
  ];

  const width = doc.canvas?.width ?? 64;
  const height = doc.canvas?.height ?? 64;
  const svg = composeStandaloneSvg(width, height, input.partsSvg, curves.tracks, Math.round(curves.durationMs));

  const base = `${slugify(sourceLabel)}-motion`;
  const relativeSvg = `.motion-mcp/generated-assets/${base}.svg`;
  const sceneDirRelative = `.motion-mcp/motion-curves/${slugify(sourceLabel)}`;
  const relativeScene = `${sceneDirRelative}/scene.json`;
  const sceneJson = `${JSON.stringify(doc, null, 2)}\n`;

  await fs.mkdir(path.join(root, path.dirname(relativeSvg)), { recursive: true });
  await fs.mkdir(path.join(root, sceneDirRelative), { recursive: true });
  await fs.writeFile(path.join(root, relativeSvg), svg, "utf8");
  await fs.writeFile(path.join(root, relativeScene), sceneJson, "utf8");

  const asset = assetFromSvg(root, relativeSvg, svg, "vectorized");
  asset.semanticLabels = [
    ...asset.semanticLabels,
    `motion-curves:${curves.tracks.length}-tracks`
  ];
  await upsertIndexedAsset(root, asset);

  // Deterministic per (parts, easing): identical input overwrites its own
  // diff instead of minting a new id per call.
  const diffId = stableId(
    "diff",
    `motion_to_curves:${relativeSvg}:${JSON.stringify(curves.tracks)}:${input.easing ?? ""}`
  );
  const files: FileChange[] = [
    { path: relativeSvg, mode: "create", content: `${svg}\n` },
    { path: relativeScene, mode: "create", content: sceneJson }
  ];
  await writeDiff(root, {
    diffId,
    rootPath: root,
    componentId: asset.id,
    summary:
      `Motion curves from ${sourceLabel}: ${input.parts.length} tracked parts → ` +
      `${curves.tracks.length} eased tracks over ${Math.round(curves.durationMs)}ms.`,
    framework: "unknown",
    creditsConsumed: 8,
    validationStatus: {
      ok: true,
      skipped: true,
      reason: "Generated vector assets are staged; validation runs after apply_motion_diff."
    },
    files,
    unifiedDiff: toUnifiedDiff(files),
    createdAt: nowIso()
  });

  const previewPath = path.join(root, ".motion-mcp", "previews", `${diffId}.svg`);
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(previewPath, svg, "utf8");

  return {
    ok: true,
    diffId,
    assetId: asset.id,
    assetPath: relativeSvg,
    scenePath: relativeScene,
    trackCount: curves.tracks.length,
    animatedParts: new Set(curves.tracks.map((track) => track.targetPart)).size,
    durationMs: Math.round(curves.durationMs),
    tracks: curves.tracks.flatMap((track) => {
      // Receipts carry only the numeric translate tracks this tool emits.
      if (track.property !== "translateX" && track.property !== "translateY") return [];
      return [{
        targetPart: track.targetPart,
        property: track.property,
        keys: track.keys.map((key) => ({ t: key.t, value: Number(key.value) }))
      }];
    }),
    previewUrl: `file://${previewPath}`,
    nextTools: ["generate_animation", "capture_gif"]
  };
}

/**
 * Standalone playable SVG: persistent per-part layers plus a <style> block
 * whose CSS keyframes mirror the eased SceneDoc tracks, so the asset looks
 * right in any browser before codegen ever runs.
 */
function composeStandaloneSvg(
  width: number,
  height: number,
  partsSvg: string | undefined,
  tracks: SceneTrack[],
  durationMs: number
): string {
  const byPart = new Map<string, { x?: SceneTrack; y?: SceneTrack }>();
  for (const track of tracks) {
    const entry = byPart.get(track.targetPart) ?? {};
    if (track.property === "translateX") entry.x = track;
    if (track.property === "translateY") entry.y = track;
    byPart.set(track.targetPart, entry);
  }

  const styleBlocks: string[] = [];
  let ruleIndex = 0;
  for (const [partId, axes] of byPart) {
    ruleIndex += 1;
    const times = Array.from(
      new Set([...(axes.x?.keys ?? []), ...(axes.y?.keys ?? [])].map((key) => key.t))
    ).sort((a, b) => a - b);
    const xByKey = new Map((axes.x?.keys ?? []).map((key) => [key.t, key.value]));
    const yByKey = new Map((axes.y?.keys ?? []).map((key) => [key.t, key.value]));
    const easingByKey = new Map((axes.x?.keys ?? []).map((key) => [key.t, key.easing]));
    const frames = times.map((t, index) => {
      const pct = Math.min(100, Number(((t / Math.max(durationMs, 1)) * 100).toFixed(2)));
      const x = numeric(xByKey.get(t));
      const y = numeric(yByKey.get(t));
      const timing = index < times.length - 1
        ? ` animation-timing-function: ${EASE_TO_CSS[(easingByKey.get(t) as MotionCurveEasing) ?? "easeInOut"] ?? "ease-in-out"};`
        : "";
      return `${pct}% { transform: translate(${round1(x)}px, ${round1(y)}px);${timing} }`;
    });
    const safeId = partId.replace(/[^a-zA-Z0-9_-]+/g, "-");
    styleBlocks.push(
      `@keyframes mc-${ruleIndex}-${safeId} { ${frames.join(" ")} }\n` +
      `#${safeId} { animation: mc-${ruleIndex}-${safeId} ${durationMs}ms linear infinite; }`
    );
  }

  const body = partsSvg
    ? partsSvg.split("\n").map((line) => `  ${line}`).join("\n")
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n` +
    (styleBlocks.length > 0 ? `  <style>\n    ${styleBlocks.join("\n    ")}\n  </style>\n` : "") +
    (body ? `${body}\n` : "") +
    `</svg>`
  );

  function round1(value: number): number {
    return Math.round(value * 10) / 10;
  }

  function numeric(value: unknown): number {
    return typeof value === "number" ? value : 0;
  }
}

function assetFromSvg(
  root: string,
  relativePath: string,
  svg: string,
  source: AssetInfo["source"]
): AssetInfo {
  void root;
  const pathTree = parseSvgTree(svg);
  const semanticLabels = Array.from(
    new Set(pathTree.flatMap(flattenSvgNodes).map((node) => node.semanticLabel ?? node.roleGuess))
  );
  return {
    id: stableId("asset", relativePath),
    path: relativePath,
    type: "svg",
    source,
    dimensions: parseSvgDimensions(svg),
    pathTree,
    semanticLabels,
    sizeBytes: Buffer.byteLength(svg, "utf8")
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "motion-asset";
}
