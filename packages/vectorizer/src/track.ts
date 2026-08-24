import type { Point } from "./trace.js";

export interface PartFrameSample {
  partId: string;
  tMs: number;
  centroid: { x: number; y: number };
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface TrackedPart {
  partId: string;
  label: string;
  frames: PartFrameSample[];
  /** Max pairwise centroid distance across the part's samples, in px. */
  displacementPx: number;
}

export interface TrackResult {
  parts: TrackedPart[];
  /** Loops that matched no predecessor and opened new parts. */
  unmatchedLoops: number;
}

export interface TrackOptions {
  canvas?: { width: number; height: number };
  /** Minimum IoU for a loop-to-predecessor match. Default 0.15. */
  minIou?: number;
  /** Max centroid jump as a fraction of the canvas diagonal per frame step. Default 0.25. */
  maxJumpRatio?: number;
}

interface LoopBox {
  points: Point[];
  centroid: { x: number; y: number };
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}

/**
 * Cross-frame part tracking for video flipbooks.
 *
 * Assigns stable partIds to traced loops across the temporally-reduced
 * frames using greedy IoU + centroid-distance matching between consecutive
 * frames. Deterministic: ties break by IoU desc, then area desc, then loop
 * order — never by Map iteration order.
 */
export function trackPartsAcrossFrames(
  frames: Array<{ tMs: number; loops: Point[][] }>,
  options: TrackOptions = {}
): TrackResult {
  const minIou = options.minIou ?? 0.15;
  const maxJumpRatio = options.maxJumpRatio ?? 0.25;
  const diagonal = Math.hypot(options.canvas?.width ?? 0, options.canvas?.height ?? 0);
  const maxJump = diagonal > 0 ? maxJumpRatio * diagonal : Infinity;

  const boxes = frames.map((frame) => frame.loops.map(toLoopBox));
  const parts: TrackedPart[] = [];
  let unmatchedLoops = 0;

  if (boxes.length === 0) return { parts, unmatchedLoops };

  // Seed tracks from frame 0 (area-desc so labels follow visual prominence).
  const openTracks = new Map<string, LoopBox>();
  const seedOrder = boxes[0]!
    .map((box, index) => ({ box, index }))
    .sort((a, b) => b.box.area - a.box.area || a.index - b.index);
  for (const { box } of seedOrder) {
    const partId = `part-${String(parts.length + 1).padStart(2, "0")}`;
    unmatchedLoops += 1;
    parts.push({
      partId,
      label: `Part ${String(parts.length + 1).padStart(2, "0")}`,
      frames: [sampleOf(partId, frames[0]!.tMs, box)],
      displacementPx: 0
    });
    openTracks.set(partId, box);
  }

  // Walk remaining frames greedily.
  for (let f = 1; f < boxes.length; f += 1) {
    const tMs = frames[f]!.tMs;
    const candidates = boxes[f]!
      .map((box, index) => ({ box, index }))
      .sort((a, b) => b.box.area - a.box.area || a.index - b.index);
    const claimed = new Set<number>();
    const nextOpen = new Map<string, LoopBox>();

    // Score every (openTrack, candidate) pair, then accept matches best-first.
    interface PairScore { trackId: string; index: number; iou: number; dist: number }
    const pairs: PairScore[] = [];
    for (const [trackId, box] of openTracks) {
      for (const { box: candidate, index } of candidates) {
        if (claimed.has(index)) continue;
        const iou = intersectionOverUnion(box.bbox, candidate.bbox);
        const dist = Math.hypot(box.centroid.x - candidate.centroid.x, box.centroid.y - candidate.centroid.y);
        if (iou >= minIou && dist <= maxJump) pairs.push({ trackId, index, iou, dist });
      }
    }
    pairs.sort((a, b) => b.iou - a.iou || a.dist - b.dist);

    const matchedTracks = new Set<string>();
    for (const pair of pairs) {
      if (matchedTracks.has(pair.trackId) || claimed.has(pair.index)) continue;
      matchedTracks.add(pair.trackId);
      claimed.add(pair.index);
      const part = parts.find((entry) => entry.partId === pair.trackId)!;
      const box = candidates.find((entry) => entry.index === pair.index)!.box;
      part.frames.push(sampleOf(part.partId, tMs, box));
      nextOpen.set(pair.trackId, box);
    }

    // Tracks with no match this frame die (no prediction/smoothing — flipbook
    // keyframes are sparse by design).
    for (const { box: candidate, index } of candidates) {
      if (claimed.has(index)) continue;
      const partId = `part-${String(parts.length + 1).padStart(2, "0")}`;
      unmatchedLoops += 1;
      parts.push({
        partId,
        label: `Part ${String(parts.length + 1).padStart(2, "0")}`,
        frames: [sampleOf(partId, tMs, candidate)],
        displacementPx: 0
      });
      nextOpen.set(partId, candidate);
    }

    openTracks.clear();
    for (const [key, value] of nextOpen) openTracks.set(key, value);
  }

  for (const part of parts) {
    part.displacementPx = maxPairwiseDistance(part.frames.map((sample) => sample.centroid));
  }

  return { parts, unmatchedLoops };
}

function toLoopBox(points: Point[]): LoopBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
    sumX += point.x;
    sumY += point.y;
  }
  const count = Math.max(points.length, 1);
  return {
    points,
    centroid: { x: sumX / count, y: sumY / count },
    bbox: { minX, minY, maxX, maxY },
    area: Math.abs(shoelaceArea(points))
  };
}

function sampleOf(partId: string, tMs: number, box: LoopBox): PartFrameSample {
  return { partId, tMs, centroid: { ...box.centroid }, bbox: { ...box.bbox } };
}

function intersectionOverUnion(
  a: LoopBox["bbox"],
  b: LoopBox["bbox"]
): number {
  const interMinX = Math.max(a.minX, b.minX);
  const interMinY = Math.max(a.minY, b.minY);
  const interMaxX = Math.min(a.maxX, b.maxX);
  const interMaxY = Math.min(a.maxY, b.maxY);
  const interW = interMaxX - interMinX;
  const interH = interMaxY - interMinY;
  if (interW <= 0 || interH <= 0) return 0;
  const inter = interW * interH;
  const areaA = (a.maxX - a.minX) * (a.maxY - a.minY);
  const areaB = (b.maxX - b.minX) * (b.maxY - b.minY);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function maxPairwiseDistance(points: Array<{ x: number; y: number }>): number {
  let max = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
      if (d > max) max = d;
    }
  }
  return max;
}

function shoelaceArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length];
    sum += a.x * b!.y - b!.x * a.y;
  }
  return sum / 2;
}
