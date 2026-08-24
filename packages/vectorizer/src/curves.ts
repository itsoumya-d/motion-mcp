import {
  SCENE_FORMAT_VERSION,
  type SceneClip,
  type SceneDoc,
  type SceneTrack
} from "@motion-mcp/scene-graph";
import type { TrackedPart } from "./track.js";

export interface MotionCurvesOptions {
  /** Easing applied between keyframes. Default "easeInOut". */
  easing?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold" | "spring";
  /** Extra tail past the last sample so a loop wraps without popping. Default 1000. */
  tailMs?: number;
}

export interface MotionCurvesResult {
  doc: SceneDoc;
  /**
   * Flat eased translate tracks — the same arrays embedded in
   * `doc.artboards[0].clips["clip-play"].tracks`, surfaced for direct
   * inspection by callers and tool receipts.
   */
  tracks: SceneTrack[];
  partsSvg: string;
  durationMs: number;
}

function loopToPath(points: Array<{ x: number; y: number }>): string {
  const round = (value: number) =>
    Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  const parts = points.map(
    (point, index) => `${index === 0 ? "M" : "L"}${round(point.x)},${round(point.y)}`
  );
  return `${parts.join("")}Z`;
}

/**
 * Motion-to-curves: converts tracked part trajectories into eased
 * translateX/translateY tracks over persistent per-part layers, so video
 * motion plays smoothly at low keyframe counts instead of hard flipbook
 * cuts. Offsets are relative to each part's base (first-sample) pose;
 * static parts become plain layers with no tracks; geometry-less parts
 * still animate via centroid offsets but emit no layer markup.
 */
export function buildMotionCurves(
  parts: TrackedPart[],
  options: MotionCurvesOptions = {}
): MotionCurvesResult {
  const easing = options.easing ?? ("easeInOut" as const);
  const tailMs = options.tailMs ?? 1000;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    for (const frame of part.frames) {
      minX = Math.min(minX, frame.bbox.minX);
      minY = Math.min(minY, frame.bbox.minY);
      maxX = Math.max(maxX, frame.bbox.maxX);
      maxY = Math.max(maxY, frame.bbox.maxY);
    }
  }
  const width = Math.ceil(Number.isFinite(maxX) ? maxX + 1 : 1);
  const height = Math.ceil(Number.isFinite(maxY) ? maxY + 1 : 1);

  const tracks: SceneTrack[] = [];
  const layerMarkup: string[] = [];
  let durationMs = 0;

  for (const part of [...parts].sort((a, b) => a.partId < b.partId ? -1 : 1)) {
    const base = part.frames[0];
    if (!base || part.frames.length === 0) continue;

    // Layer markup only when we have base geometry.
    const firstLoop = part.frames.map((frame) => frame.loop).find((loop) => loop !== undefined);
    if (firstLoop && base.fill) {
      layerMarkup.push(`<g id="${part.partId}"><path d="${loopToPath(firstLoop)}" fill="${base.fill}"/></g>`);
    }

    const lastT = part.frames[part.frames.length - 1]!.tMs;
    durationMs = Math.max(durationMs, lastT);
    if (part.displacementPx <= 0 || part.frames.length < 2) continue;

    const txKeys: Array<{ t: number; value: number; easing: MotionCurvesOptions["easing"] }> = [];
    const tyKeys: Array<{ t: number; value: number; easing: MotionCurvesOptions["easing"] }> = [];
    for (const frame of part.frames) {
      txKeys.push({ t: frame.tMs, value: round1(frame.centroid.x - base.centroid.x), easing });
      tyKeys.push({ t: frame.tMs, value: round1(frame.centroid.y - base.centroid.y), easing });
    }
    tracks.push({ targetPart: part.partId, property: "translateX", keys: txKeys });
    tracks.push({ targetPart: part.partId, property: "translateY", keys: tyKeys });
  }

  durationMs += tailMs;

  const clip: SceneClip = {
    clipId: "clip-play",
    name: "play",
    durationMs,
    loop: true,
    tracks
  };

  const doc: SceneDoc = {
    formatVersion: SCENE_FORMAT_VERSION,
    sceneId: `scene_motion_curves_${Date.now()}`,
    name: "tracked motion curves",
    createdAt: new Date().toISOString(),
    canvas: { width, height },
    artboards: [
      {
        artboardId: "motion-curves",
        name: "tracked motion curves",
        layers: [],
        clips: { "clip-play": clip },
        stateMachines: [],
        bindings: [],
        listeners: [],
        audioEvents: []
      }
    ]
  };

  return {
    doc,
    tracks,
    partsSvg: layerMarkup.join("\n"),
    durationMs
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
