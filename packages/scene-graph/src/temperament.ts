import type { SceneArtboard, SceneClip, SceneDoc, SceneEasing, SceneTemperament } from "./types.js";

export const TEMPERAMENT_PRESETS: Record<string, SceneTemperament> = {
  calm: { energy: 0.2, weight: 0.55, warmth: 0.6, precision: 0.5 },
  energetic: { energy: 0.9, weight: 0.25, warmth: 0.7, precision: 0.3 },
  nervous: { energy: 0.75, weight: 0.2, warmth: 0.35, precision: 0.15 },
  playful: { energy: 0.8, weight: 0.45, warmth: 0.85, precision: 0.35 },
  precise: { energy: 0.5, weight: 0.5, warmth: 0.2, precision: 0.95 },
  heavy: { energy: 0.35, weight: 0.95, warmth: 0.3, precision: 0.6 }
};

export function resolveTemperament(
  input: string | Partial<SceneTemperament> | undefined
): SceneTemperament {
  if (typeof input === "string") {
    const preset = TEMPERAMENT_PRESETS[input.toLowerCase()];
    if (!preset) {
      throw new Error(
        `Unknown temperament "${input}". Known presets: ${Object.keys(TEMPERAMENT_PRESETS).join(", ")}.`
      );
    }
    return { ...preset };
  }
  const base: SceneTemperament = { energy: 0.5, weight: 0.5, warmth: 0.5, precision: 0.5 };
  if (!input) return base;
  return {
    energy: clamp01(input.energy ?? base.energy),
    weight: clamp01(input.weight ?? base.weight),
    warmth: clamp01(input.warmth ?? base.warmth),
    precision: clamp01(input.precision ?? base.precision)
  };
}

export interface TemperamentMotionProfile {
  /** Multiplier applied to all keyframe times and clip durations. */
  durationScale: number;
  /** Percent past-target overshoot eligible tracks may express (0 disables). */
  overshootPercent: number;
  /** Squash/stretch intensity on arrival moments in [0,1]. */
  squashStretch: number;
  /** Multiplier on ambient secondary-motion amplitudes (breathe/sway). */
  secondaryAmplitude: number;
  /** Multiplier on per-part stagger offsets. */
  staggerScale: number;
  /** Easing substituted for mechanical linear segments. */
  preferredEasing: SceneEasing;
}

export function temperamentProfile(temperament: SceneTemperament): TemperamentMotionProfile {
  return {
    durationScale: round3(1.3 - 0.6 * temperament.energy),
    overshootPercent: Math.max(
      0,
      Math.round(12 * temperament.energy - 8 * temperament.weight - 12 * temperament.precision)
    ),
    squashStretch: round3(temperament.weight * (1 - temperament.precision * 0.5)),
    secondaryAmplitude: round3(0.4 + 1.2 * temperament.warmth - 0.3 * temperament.precision),
    staggerScale: round3(1 - 0.7 * temperament.precision),
    preferredEasing:
      temperament.precision >= 0.66 ? "easeInOut" : temperament.energy >= 0.5 ? "easeOut" : "easeInOut"
  };
}

const LINEAR_REWRITE_MIN_SPAN_MS = 120;

/**
 * Deterministically reshapes a clip's timing and easing to express a
 * temperament profile. Pure: identical inputs yield identical clips.
 * Time scaling is monotonic so key order and loop seams are preserved by
 * construction; amplitudes are never invented here, keeping the transform
 * safe on hand-authored motion.
 */
export function applyTemperamentToClip(clip: SceneClip, profile: TemperamentMotionProfile): SceneClip {
  return {
    ...clip,
    durationMs: Math.max(1, Math.round(clip.durationMs * profile.durationScale)),
    tracks: clip.tracks.map((track) => ({
      ...track,
      keys: track.keys.map((key, index) => ({
        ...key,
        t: Math.round(key.t * profile.durationScale),
        easing:
          key.easing === "linear" &&
          segmentSpanMs(track.keys, index) >= LINEAR_REWRITE_MIN_SPAN_MS
            ? profile.preferredEasing
            : key.easing
      }))
    }))
  };
}

/** Applies a temperament across every artboard's clips and stamps it on each. */
export function applyTemperamentToDoc(
  doc: SceneDoc,
  input: string | Partial<SceneTemperament>
): { doc: SceneDoc; profile: TemperamentMotionProfile; temperament: SceneTemperament } {
  const temperament = resolveTemperament(input);
  const profile = temperamentProfile(temperament);
  const artboards: SceneArtboard[] = doc.artboards.map((artboard) => ({
    ...artboard,
    temperament,
    clips: Object.fromEntries(
      Object.entries(artboard.clips).map(([clipId, clip]) => [clipId, applyTemperamentToClip(clip, profile)])
    )
  }));
  return { doc: { ...doc, artboards }, profile, temperament };
}

function segmentSpanMs(keys: Array<{ t: number }>, index: number): number {
  if (index <= 0) return Infinity;
  return Math.abs(keys[index]!.t - keys[index - 1]!.t);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
