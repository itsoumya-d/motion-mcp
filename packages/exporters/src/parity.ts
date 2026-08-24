import type { SceneArtboard, SceneClip, SceneDoc, SceneTrack } from "@motion-mcp/scene-graph";
import { pickArtboard, pickClip, toAnimatedSvg } from "./animated-svg.js";
import { toLottie } from "./lottie.js";

export type ParityTarget = "animated-svg" | "lottie";

export interface ParityTargetReport {
  target: ParityTarget;
  ok: boolean;
  /** Ground-truth stop count the clip implies for this target. */
  expectedStops: number;
  /** Stops recovered from the exported artifact. */
  observedStops: number;
  mismatches: Array<{ property: string; kind: "missing" | "extra"; detail: string }>;
}

export interface ParityReport {
  ok: boolean;
  score: number;
  state: string;
  durationMs: number;
  targets: ParityTargetReport[];
  note: string;
}

export interface ParityOptions {
  artboardId?: string;
  state?: string;
  /** Fps used when exporting Lottie; drives the frame-quantization tolerance. Default 60. */
  fps?: number;
}

const TRANSFORM_PROPERTIES = new Set([
  "translateX",
  "translateY",
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotate"
]);

const PAINT_LABELS: Record<string, string> = {
  opacity: "opacity",
  pathlength: "pathLength",
  fill: "fill",
  stroke: "stroke",
  strokewidth: "strokeWidth"
};

/**
 * Export parity verification: bake one clip through BOTH renderable targets
 * and confirm every motion stop survived the round trip.
 *
 * This catches exporter drift (a property one target silently drops, a time
 * that quantizes out of existence) before an asset ships. It is structural:
 * stop TIMES per property bucket, not pixels. Pixel-level cross-rendering
 * needs a headless Lottie player and remains future work.
 */
export function verifyExportParity(doc: SceneDoc, options: ParityOptions = {}): ParityReport {
  const artboard = pickArtboard(doc, options.artboardId);
  const clip = pickClip(artboard, options.state);
  const fps = Math.min(Math.max(options.fps ?? 60, 12), 120);

  const svgText = toAnimatedSvg(doc, { artboardId: artboard.artboardId, state: options.state });
  const lottieJson = toLottie(doc, { artboardId: artboard.artboardId, state: options.state, fps });

  const svgReport = checkSvgTarget(svgText, clip);
  const lottieReport = checkLottieTarget(lottieJson, clip, fps);

  let score = 100;
  for (const report of [svgReport, lottieReport]) {
    for (const mismatch of report.mismatches) {
      score -= mismatch.kind === "missing" ? 10 : 4;
    }
  }
  score = Math.max(0, score);

  return {
    ok: svgReport.ok && lottieReport.ok,
    score,
    state: clip.name,
    durationMs: clip.durationMs,
    targets: [svgReport, lottieReport],
    note:
      "Structural stop-parity across both renderable exports. Pixel-level visual diffing requires a headless Lottie renderer (roadmap)."
  };
}

// ---------------------------------------------------------------------------
// animated-SVG target
// ---------------------------------------------------------------------------

function checkSvgTarget(svgText: string, clip: SceneClip): ParityTargetReport {
  const observed = parseSvgKeyframes(svgText);
  const expected: Record<string, Set<number>> = {};
  for (const track of clip.tracks) {
    const bucket = TRANSFORM_PROPERTIES.has(track.property) ? "transform" : paintLabel(track.property);
    const set = expected[bucket] ?? (expected[bucket] = new Set<number>());
    for (const key of track.keys) set.add(key.t);
  }

  const toleranceMs = 2;
  return diffBuckets("animated-svg", expected, observed, clip, toleranceMs);
}

function parseSvgKeyframes(svgText: string): Record<string, Set<number>> {
  const durationMatch = svgText.match(/animation:[^;]*?(\d+(?:\.\d+)?)ms/);
  const durationMs = durationMatch ? Number.parseFloat(durationMatch[1]!) : 0;
  const observed: Record<string, Set<number>> = {};
  const blockPattern = /@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(svgText)) !== null) {
    const name = block[1]!;
    const bucket = svgBucketForKeyframeName(name);
    const set = observed[bucket] ?? (observed[bucket] = new Set<number>());
    const stopPattern = /([\d.]+)% \{/g;
    let stop: RegExpExecArray | null;
    while ((stop = stopPattern.exec(block[2]!)) !== null && durationMs > 0) {
      set.add(Math.round((Number.parseFloat(stop[1]!) / 100) * durationMs));
    }
  }
  return observed;
}

function svgBucketForKeyframeName(name: string): string {
  if (/^mcp-t\d+$/.test(name)) return "transform";
  const match = name.match(/^mcp-p\d+-(.+)$/);
  if (!match) return name;
  return PAINT_LABELS[match[1]!] ?? match[1]!;
}

function paintLabel(property: string): string {
  return PAINT_LABELS[property.toLowerCase()] ?? property;
}

// ---------------------------------------------------------------------------
// Lottie target
// ---------------------------------------------------------------------------

interface LottieKeyframed {
  a: number;
  k: unknown;
}

function checkLottieTarget(lottieJson: Record<string, unknown>, clip: SceneClip, fps: number): ParityTargetReport {
  const observed: Record<string, Set<number>> = {};
  const framesPerSecond = Number(lottieJson.fr ?? fps) || fps;
  const layers = (lottieJson.layers ?? []) as Array<{ ks?: Record<string, LottieKeyframed> }>;

  for (const layer of layers) {
    const ks = layer.ks ?? {};
    const channelMap: Array<[string, LottieKeyframed | undefined]> = [
      ["opacity", ks.o],
      ["rotate", ks.r],
      ["translate", ks.p],
      ["scale", ks.s]
    ];
    for (const [bucket, prop] of channelMap) {
      if (!prop || prop.a !== 1) continue;
      const set = observed[bucket] ?? (observed[bucket] = new Set<number>());
      for (const keyframe of prop.k as Array<{ t: number }>) {
        set.add(Math.round((keyframe.t / framesPerSecond) * 1000));
      }
    }
  }

  // Channel expectations: note that scaleX/scaleY belong to the Lottie scale
  // bucket even though the emitter only reads scalar "scale" — a scaleX-only
  // clip is exactly the exporter drift this target exists to catch.
  const expected: Record<string, Set<number>> = {
    opacity: unionOf(clip.tracks, ["opacity"]),
    rotate: unionOf(clip.tracks, ["rotate"]),
    translate: unionOf(clip.tracks, ["translateX", "translateY", "x", "y"]),
    scale: unionOf(clip.tracks, ["scale", "scaleX", "scaleY"])
  };
  for (const track of clip.tracks) {
    if (TRANSFORM_PROPERTIES.has(track.property)) continue;
    if (track.property === "opacity") continue;
    const label = PAINT_LABELS[track.property.toLowerCase()] ?? track.property;
    const set = expected[label] ?? (expected[label] = new Set<number>());
    for (const key of track.keys) set.add(key.t);
  }

  const toleranceMs = Math.max(2, Math.ceil(1000 / fps / 2));
  return diffBuckets("lottie", expected, observed, clip, toleranceMs);
}

function unionOf(tracks: SceneTrack[], properties: string[]): Set<number> {
  const set = new Set<number>();
  for (const track of tracks) {
    if (!properties.includes(track.property)) continue;
    for (const key of track.keys) set.add(key.t);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Shared diffing
// ---------------------------------------------------------------------------

function diffBuckets(
  target: ParityTarget,
  expected: Record<string, Set<number>>,
  observed: Record<string, Set<number>>,
  clip: SceneClip,
  toleranceMs: number
): ParityTargetReport {
  const mismatches: ParityTargetReport["mismatches"] = [];
  let expectedCount = 0;
  let observedCount = 0;

  const buckets = new Set([...Object.keys(expected), ...Object.keys(observed)]);
  for (const bucket of buckets) {
    const want = [...(expected[bucket] ?? [])].sort((a, b) => a - b);
    const got = [...(observed[bucket] ?? [])].sort((a, b) => a - b);
    expectedCount += want.length;
    observedCount += got.length;

    if (want.length === 0 && got.length === 0) continue;
    for (const time of want) {
      if (!got.some((candidate) => Math.abs(candidate - time) <= toleranceMs)) {
        mismatches.push({
          property: bucket,
          kind: "missing",
          detail: `t=${time}ms absent from ${target} output (±${toleranceMs}ms)`
        });
      }
    }
    for (const time of got) {
      if (!want.some((candidate) => Math.abs(candidate - time) <= toleranceMs)) {
        mismatches.push({
          property: bucket,
          kind: "extra",
          detail: `${target} emits t=${time}ms which the clip does not define`
        });
      }
    }
  }

  void clip;
  return {
    target,
    ok: mismatches.length === 0,
    expectedStops: expectedCount,
    observedStops: observedCount,
    mismatches: mismatches.slice(0, 20)
  };
}

export function pickStateName(doc: SceneDoc, options: ParityOptions = {}): string {
  const artboard: SceneArtboard | undefined = pickArtboard(doc, options.artboardId);
  return pickClip(artboard!, options.state).name;
}
