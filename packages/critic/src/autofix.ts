import type { SceneClip, SceneDoc, SceneKeyframe, SceneTrack } from "@motion-mcp/scene-graph";
import { DEFAULT_RUBRIC, REPAIR_FIXES, type MotionRubric } from "./rubric.js";
import type { MotionCritique } from "./checks.js";

export interface AutoFixResult {
  doc: SceneDoc;
  /** Applied mechanical fixes, in order. */
  applied: string[];
}

export interface AutoFixOptions {
  rubric?: MotionRubric;
}

const LINEAR_REWRITE_MIN_SPAN_MS = 120;

/**
 * Applies only SAFE, deterministic fixes for failure modes the critic
 * detects — key sorting, bounds clamping, loop-seam wrap keys, and linear-
 * easing rewrites. It never invents new motion amplitudes; anything beyond
 * the allowlist needs host-agent work guided by the critique's `fixes`.
 */
export function autoFixScene(doc: SceneDoc, options: AutoFixOptions = {}): AutoFixResult {
  const rubric = options.rubric ?? DEFAULT_RUBRIC;
  const allowed = new Set(rubric.repair.allowedFixes.length > 0 ? rubric.repair.allowedFixes : [...REPAIR_FIXES]);
  const applied: string[] = [];
  const artboards = doc.artboards.map((artboard) => ({
    ...artboard,
    clips: Object.fromEntries(
      Object.entries(artboard.clips).map(([clipId, clip]) => {
        const fixed = autoFixClip(clip, applied, allowed);
        return [clipId, fixed];
      })
    )
  }));
  return { doc: { ...doc, artboards }, applied };
}

function autoFixClip(clip: SceneClip, applied: string[], allowed: Set<string>): SceneClip {
  const tracks = clip.tracks.map((track) => autoFixTrack(track, clip, applied, allowed));
  return { ...clip, tracks };
}

/** Repairs one track's keys; each fix is gated by the rubric allowlist. */
export function autoFixTrack(
  track: SceneTrack,
  clip: SceneClip,
  applied: string[],
  allowed: Set<string>
): SceneTrack {
  let keys = [...track.keys];
  const evidence = `${clip.name}:${track.targetPart}.${track.property}`;

  if (allowed.has("sort-keys")) {
    const wasUnsorted = keys.some((key, index) => index > 0 && key.t < keys[index - 1]!.t);
    if (wasUnsorted) {
      keys = keys
        .map((key, index) => ({ key, index }))
        .sort((a, b) => a.key.t - b.key.t || a.index - b.index)
        .map((entry) => entry.key);
      applied.push(`sorted keys on ${evidence}`);
    }
  }

  if (allowed.has("clamp-bounds") && /^opacity$/.test(track.property)) {
    const clamped = keys.map((key): SceneKeyframe =>
      typeof key.value === "number" && (key.value < 0 || key.value > 1)
        ? { ...key, value: Math.max(0, Math.min(1, key.value)) }
        : key
    );
    const changed = clamped.some(
      (key, index) => key.value !== (keys[index] as SceneKeyframe).value
    );
    if (changed) {
      applied.push(`clamped opacity on ${evidence}`);
    }
    keys = clamped;
  }

  if (allowed.has("loop-wrap")) {
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
      keys =
        lastKey!.t === clip.durationMs
          ? [...keys.slice(0, -1), { ...lastKey!, value: firstValue }]
          : [...keys, { ...lastKey!, t: clip.durationMs, value: firstValue }];
      applied.push(`added loop wrap key on ${evidence}`);
    }
  }

  if (allowed.has("rewrite-linear-easing")) {
    const rewritten = keys.map((key, index): SceneKeyframe => {
      if (key.easing !== "linear" || index === 0) return key;
      const span = Math.abs(key.t - keys[index - 1]!.t);
      return span >= LINEAR_REWRITE_MIN_SPAN_MS ? { ...key, easing: "easeOut" } : key;
    });
    const changed = rewritten.some((key, index) => key.easing !== keys[index]!.easing);
    if (changed) {
      applied.push(`rewrote mechanical linear easing on ${evidence}`);
    }
    keys = rewritten;
  }

  return { ...track, keys };
}

/** Convenience: critique → single-pass autofix → re-critique. */
export async function critiqueWithAutoFix(
  doc: SceneDoc,
  critiqueFn: (candidate: SceneDoc) => Promise<MotionCritique>,
  options: AutoFixOptions = {}
): Promise<{ report: MotionCritique; fixed?: MotionCritique; result?: AutoFixResult }> {
  const report = await critiqueFn(doc);
  if (report.ok) return { report };
  const result = autoFixScene(doc, options);
  if (result.applied.length === 0) return { report };
  const fixed = await critiqueFn(result.doc);
  return { report, fixed, result };
}
