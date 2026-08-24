import type { SceneBone, SceneRig } from "@motion-mcp/scene-graph";

/**
 * Structural input shape — matches @motion-mcp/vectorizer's TrackedPart
 * without coupling anatomy-engine to that package.
 */
export interface RigTrackSample {
  tMs: number;
  centroid: { x: number; y: number };
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface RigTrackPart {
  partId: string;
  label?: string;
  displacementPx: number;
  frames: RigTrackSample[];
}

export interface InferRigOptions {
  canvas?: { width: number; height: number };
  /** Parts moving less than this many px ride the root instead of getting a bone. Default: max(6, 3% of diagonal). */
  stillThresholdPx?: number;
}

export interface VideoRigResult {
  rig: SceneRig;
  /** PartIds folded into their parent instead of earning their own bone. */
  stillParts: string[];
}

interface PlacedPart {
  track: RigTrackPart;
  boneId: string;
  area: number;
}

function bboxArea(bbox: RigTrackSample["bbox"]): number {
  return Math.max(bbox.maxX - bbox.minX, 0) * Math.max(bbox.maxY - bbox.minY, 0);
}

function averageArea(track: RigTrackPart): number {
  if (track.frames.length === 0) return 0;
  return (
    track.frames.reduce((sum, sample) => sum + bboxArea(sample.bbox), 0) /
    track.frames.length
  );
}

function overlapRatio(child: RigTrackPart, parent: RigTrackPart): number {
  const a = child.frames[0]?.bbox;
  const b = parent.frames[0]?.bbox;
  if (!a || !b) return 0;
  const interW = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const interH = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (interW <= 0 || interH <= 0) return 0;
  const own = bboxArea(a);
  return own > 0 ? (interW * interH) / own : 0;
}

/**
 * Infers a minimal SceneDoc character rig from tracked video parts.
 *
 * Deterministic rules: the least-displaced (largest on ties) tracked part
 * becomes the root bone; every part whose displacement exceeds the still
 * threshold earns its own bone parented to the nearest already-placed part
 * by first-sample centroid distance; weights record bbox overlap with the
 * parent, clamped to [0.05, 1]. No species schema required — this is the
 * video-flipbook sibling of buildCharacterRig()'s universal guarantee.
 */
export function inferRigFromTracks(
  tracks: RigTrackPart[],
  options: InferRigOptions = {}
): VideoRigResult {
  if (tracks.length === 0) {
    return { rig: emptyRig(), stillParts: [] };
  }

  const diagonal =
    options.canvas !== undefined
      ? Math.hypot(options.canvas.width, options.canvas.height)
      : 0;
  const stillThreshold =
    options.stillThresholdPx ?? (diagonal > 0 ? Math.max(6, diagonal * 0.03) : 6);

  // Deterministic order: area desc, then displacement asc, then partId.
  const ordered = [...tracks].sort(
    (a, b) =>
      averageArea(b) - averageArea(a) ||
      a.displacementPx - b.displacementPx ||
      (a.partId < b.partId ? -1 : 1)
  );

  // Root: least-displaced part (area-desc tie-break already applied).
  let rootIndex = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i]!.displacementPx < ordered[rootIndex]!.displacementPx) rootIndex = i;
  }
  const rootTrack = ordered[rootIndex]!;
  const rootOrigin = rootTrack.frames[0]?.centroid ?? { x: 0, y: 0 };

  const bones: SceneBone[] = [
    {
      boneId: "vb-root",
      name: "video root",
      targetParts: [rootTrack.partId],
      origin: { x: rootOrigin.x, y: rootOrigin.y },
      weights: { [rootTrack.partId]: 1 }
    }
  ];
  const placed: PlacedPart[] = [
    { track: rootTrack, boneId: "vb-root", area: averageArea(rootTrack) }
  ];
  const stillParts: string[] = [];

  // Movers become bones, parented to the nearest placed part.
  const movers = ordered.filter((track) => track !== rootTrack);
  for (const track of movers) {
    if (track.displacementPx <= stillThreshold) {
      stillParts.push(track.partId);
      const parent = placed[0]!;
      bones[0]!.targetParts.push(track.partId);
      bones[0]!.weights = {
        ...bones[0]!.weights,
        [track.partId]: clampWeight(overlapRatio(track, parent.track))
      };
      continue;
    }

    const origin = track.frames[0]?.centroid ?? { x: 0, y: 0 };
    let best = placed[0];
    let bestDist = Infinity;
    for (const candidate of placed) {
      const c = candidate.track.frames[0]?.centroid;
      if (!c) continue;
      const dist = Math.hypot(c.x - origin.x, c.y - origin.y);
      if (dist < bestDist - 1e-9 || (dist <= bestDist + 1e-9 && candidate.area > best!.area)) {
        best = candidate;
        bestDist = dist;
      }
    }

    const boneId = `vb-${String(bones.length).padStart(2, "0")}`;
    bones.push({
      boneId,
      name: `video ${boneId}`,
      parentBoneId: best!.boneId,
      targetParts: [track.partId],
      origin: { x: origin.x, y: origin.y },
      weights: { [best!.track.partId]: clampWeight(overlapRatio(track, best!.track)) }
    });
    placed.push({ track, boneId, area: averageArea(track) });
  }

  return {
    rig: {
      bones,
      ikChains: [],
      secondaryMotion: []
    },
    stillParts
  };
}

function clampWeight(raw: number): number {
  return Math.min(1, Math.max(0.05, Math.round(raw * 100) / 100));
}

function emptyRig(): SceneRig {
  return {
    bones: [],
    ikChains: [],
    secondaryMotion: []
  };
}
