import type { SceneClip, SceneDoc, SceneKeyframe } from "@motion-mcp/scene-graph";
import type { MotionCritique } from "./checks.js";

export interface AutoFixResult {
  doc: SceneDoc;
  /** Applied mechanical fixes, in order. */
  applied: string[];
}

/**
 * Applies only SAFE, deterministic fixes for the failure modes the critic
 * detects: key sorting, opacity clamping, and loop-seam wrap keys.
 * It never invents new motion — anything beyond these needs host-agent work
 * guided by the critique's `fixes`.
 */
export function autoFixScene(doc: SceneDoc): AutoFixResult {
  const applied: string[] = [];
  const artboards = doc.artboards.map((artboard) => ({
    ...artboard,
    clips: Object.fromEntries(
      Object.entries(artboard.clips).map(([clipId, clip]) => {
        const fixed = autoFixClip(clip, applied);
        return [clipId, fixed];
      })
    )
  }));
  return { doc: { ...doc, artboards }, applied };
}

function autoFixClip(clip: SceneClip, applied: string[]): SceneClip {
  const tracks = clip.tracks.map((track) => {
    let keys = [...track.keys];

    // 1. Time-sort (stable for duplicate times).
    const wasUnsorted = keys.some((key, index) => index > 0 && key.t < keys[index - 1]!.t);
    if (wasUnsorted) {
      keys = keys
        .map((key, index) => ({ key, index }))
        .sort((a, b) => a.key.t - b.key.t || a.index - b.index)
        .map((entry) => entry.key);
      applied.push(`sorted keys on ${track.targetPart}.${track.property}`);
    }

    // 2. Clamp numeric values into sane bounds per property.
    if (/^opacity$/.test(track.property)) {
      const clamped = keys.map((key): SceneKeyframe =>
        typeof key.value === "number" && (key.value < 0 || key.value > 1)
          ? { ...key, value: Math.max(0, Math.min(1, key.value)) }
          : key
      );
      const changed = clamped.some(
        (key, index) => key.value !== (keys[index] as SceneKeyframe).value
      );
      if (changed) {
        applied.push(`clamped opacity on ${track.targetPart}.${track.property}`);
      }
      keys = clamped;
    }

    // 3. Loop seam wrap key.
    const firstKey = keys[0];
    const lastKey = keys[keys.length - 1];
    const firstValue = firstKey?.value;
    const lastValue = lastKey?.value;
    if (
      clip.loop &&
      keys.length >= 2 &&
      typeof firstValue === "number" &&
      typeof lastValue === "number" &&
      Math.abs(firstValue - lastValue) > 1e-6
    ) {
      keys = [...keys, { ...lastKey!, t: clip.durationMs, value: firstValue }];
      applied.push(`added loop wrap key on ${track.targetPart}.${track.property}`);
    }

    return { ...track, keys };
  });

  return { ...clip, tracks };
}

/** Convenience: critique → autofix → re-critique. */
export async function critiqueWithAutoFix(
  doc: SceneDoc,
  critiqueFn: (candidate: SceneDoc) => Promise<MotionCritique>
): Promise<{ report: MotionCritique; fixed?: MotionCritique; result?: AutoFixResult }> {
  const report = await critiqueFn(doc);
  if (report.ok) return { report };
  const result = autoFixScene(doc);
  if (result.applied.length === 0) return { report };
  const fixed = await critiqueFn(result.doc);
  return { report, fixed, result };
}
