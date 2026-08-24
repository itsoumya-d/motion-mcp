import { decodePng } from "@motion-mcp/capture";
import {
  SCENE_FORMAT_VERSION,
  type SceneArtboard,
  type SceneClip,
  type SceneDoc,
  type SceneTrack
} from "@motion-mcp/scene-graph";
import { colorToHex, quantizeFrame, type QuantizeResult } from "./quantize.js";
import type { Point } from "./trace.js";
import { simplifyLoop, traceColorMask } from "./trace.js";

export interface VectorizeOptions {
  /** Sampling fps the frames were extracted at; drives flipbook timing. */
  fps?: number;
  maxColors?: number;
  maxKeyframes?: number;
  /** RDP simplification epsilon in pixels. Default 1. */
  epsilon?: number;
  /** Drop traced loops whose pixel area is below this. Default 6. */
  minAreaPx?: number;
  /** Re-emit an identical-looking frame after this gap so long pauses tick. Default 1000. */
  staticGapMs?: number;
  /** Retain per-kept-frame traced loops for downstream part tracking. Default false. */
  keepTraces?: boolean;
}

export interface FlipbookResult {
  doc: SceneDoc;
  layeredSvg: string;
  totalFrames: number;
  keptFrames: number;
  paletteSize: number;
  width: number;
  height: number;
  frameTimesMs: number[];
  /**
   * Per-kept-frame traced loops (part segmentation before SVG emission).
   * Only populated when `keepTraces` is set — consumed by cross-frame
   * part tracking for video-to-rig inference.
   */
  traces?: Array<{ tMs: number; loops: Point[][] }>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Video-to-vector core: PNG frames in, deterministic layered-SVG flipbook
 * SceneDoc out. Frames are median-cut quantized, contour-traced, RDP-
 * simplified, then temporally reduced — visually identical consecutive
 * frames collapse into a single keyframe.
 */
export function vectorizeFrames(pngs: Uint8Array[], options: VectorizeOptions = {}): FlipbookResult {
  const fps = clamp(options.fps ?? 12, 1, 60);
  const maxColors = clamp(options.maxColors ?? 16, 2, 64);
  const maxKeyframes = clamp(options.maxKeyframes ?? 24, 1, 120);
  const epsilon = options.epsilon ?? 1;
  const minArea = options.minAreaPx ?? 6;
  const staticGapMs = options.staticGapMs ?? 1000;
  const keepTraces = options.keepTraces ?? false;

  if (pngs.length === 0) throw new Error("vectorizeFrames needs at least one frame");

  interface TracedFrame {
    index: number;
    tMs: number;
    groups: string[];
    loops: Point[][];
    signature: number;
    quantized: QuantizeResult;
  }

  const frames: TracedFrame[] = [];
  let width = 0;
  let height = 0;

  for (let index = 0; index < pngs.length; index += 1) {
    const decoded = decodePng(pngs[index]!);
    width = decoded.width;
    height = decoded.height;
    const quantized = quantizeFrame(decoded.rgba, decoded.width, decoded.height, maxColors);

    // Per-color masks → contours → simplified path data.
    const pathsByColor = new Map<number, string[]>();
    const frameLoops: Point[][] = [];
    for (let colorIndex = 0; colorIndex < quantized.palette.length; colorIndex += 1) {
      const mask = new Uint8Array(decoded.width * decoded.height);
      for (let pixel = 0; pixel < quantized.indices.length; pixel += 1) {
        if (quantized.indices[pixel] === colorIndex) mask[pixel] = 1;
      }
      const loops = traceColorMask(mask, decoded.width, decoded.height);
      const paths: Array<{ area: number; d: string }> = [];
      for (const loop of loops) {
        const area = Math.abs(shoelaceArea(loop));
        if (area < minArea) continue;
        const simplified = simplifyLoop(loop, epsilon);
        paths.push({ area, d: loopToPath(simplified) });
        frameLoops.push(simplified);
      }
      // Large regions paint first so smaller shapes layer on top.
      paths.sort((a, b) => b.area - a.area);
      if (paths.length > 0) {
        pathsByColor.set(colorIndex, paths.map((entry) => entry.d));
      }
    }

    const groupMarkup: string[] = [];
    for (const [colorIndex, paths] of pathsByColor) {
      const fill = colorToHex(quantized.palette[colorIndex]!);
      for (const d of paths) {
        groupMarkup.push(`<path d="${d}" fill="${fill}"/>`);
      }
    }

    frames.push({
      index,
      tMs: Math.round((index * 1000) / fps),
      groups: groupMarkup,
      loops: frameLoops,
      signature: signatureOf(quantized),
      quantized
    });
  }

  // Temporal reduction: drop frames identical to the last kept one, but
  // re-emit after staticGapMs so long pauses still tick.
  const kept: TracedFrame[] = [frames[0]!];
  for (let i = 1; i < frames.length; i += 1) {
    const candidate = frames[i]!;
    const last = kept[kept.length - 1]!;
    if (candidate.signature !== last.signature || candidate.tMs - last.tMs >= staticGapMs) {
      kept.push(candidate);
    }
  }
  const reduced = resampleCap(kept, maxKeyframes);

  const stepMs = Math.round(1000 / fps);
  const lastTime = reduced[reduced.length - 1]!.tMs;
  const durationMs = lastTime + stepMs;

  const groupIds = reduced.map((_, k) => `fb${k}`);
  const layeredGroups = reduced
    .map((frame, k) =>
      `<g id="fb${k}" opacity="${k === 0 ? "1" : "0"}">\n    ${frame.groups.join("\n    ")}\n  </g>`
    )
    .join("\n  ");
  const layeredSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n  ` +
    layeredGroups +
    `\n</svg>`;

  const tracks: SceneTrack[] = groupIds.map((groupId, k) => ({
    targetPart: groupId,
    property: "opacity",
    keys: [
      ...reduced.map((frame, j) => ({ t: frame.tMs, value: j === k ? 1 : 0, easing: "hold" as const })),
      { t: durationMs, value: k === 0 ? 1 : 0, easing: "hold" as const }
    ]
  }));

  const clip: SceneClip = {
    clipId: "clip-play",
    name: "play",
    durationMs,
    loop: true,
    tracks
  };

  const artboard: SceneArtboard = {
    artboardId: "flipbook",
    name: "vectorized flipbook",
    layers: [
      {
        layerId: "flipbook-layer",
        name: "flipbook",
        order: 0,
        targetParts: groupIds,
        initialStateId: "state-play"
      }
    ],
    clips: { "clip-play": clip },
    stateMachines: [
      {
        stateMachineId: "flipbook:machine",
        name: "Flipbook",
        initialStateId: "state-play",
        states: [
          {
            stateId: "state-play",
            name: "play",
            kind: "entry",
            clipId: "clip-play",
            loop: true,
            controlledParts: groupIds
          }
        ],
        transitions: []
      }
    ],
    bindings: [],
    listeners: [],
    audioEvents: [],
    semantics: { reducedMotionSafe: true }
  };

  return {
    doc: {
      formatVersion: SCENE_FORMAT_VERSION,
      sceneId: `scene_flipbook_${Date.now()}`,
      name: "vectorized flipbook",
      createdAt: new Date().toISOString(),
      canvas: { width, height },
      artboards: [artboard]
    },
    layeredSvg,
    totalFrames: frames.length,
    keptFrames: reduced.length,
    paletteSize: reduced[0]!.quantized.palette.length,
    width,
    height,
    frameTimesMs: reduced.map((frame) => frame.tMs),
    traces: keepTraces
      ? reduced.map((frame) => ({ tMs: frame.tMs, loops: frame.loops.map((loop) => loop.map((point) => ({ ...point }))) }))
      : undefined
  };
}

/** Uniform stride thinning when temporal reduction still exceeds the cap. */
function resampleCap<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const stride = items.length / cap;
  const out: T[] = [];
  for (let slot = 0; slot < cap; slot += 1) {
    out.push(items[Math.floor(slot * stride)]!);
  }
  return out;
}

function shoelaceArea(points: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function loopToPath(points: Array<{ x: number; y: number }>): string {
  const round = (value: number) => Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  const parts = points.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)},${round(point.y)}`);
  return `${parts.join("")}Z`;
}

function signatureOf(quantized: QuantizeResult): number {
  let hash = 0x811c9dc5;
  const mix = (byte: number) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const color of quantized.palette) {
    mix(color.r); mix(color.g); mix(color.b);
  }
  for (let i = 0; i < quantized.indices.length; i += 1) {
    mix(quantized.indices[i]!);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
