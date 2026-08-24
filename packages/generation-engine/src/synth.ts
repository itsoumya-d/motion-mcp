import type { SceneClip, SceneKeyframe, SceneTrack } from "@motion-mcp/scene-graph";
import {
  resolveTemperament,
  temperamentProfile,
  type SceneTemperament,
  type TemperamentMotionProfile
} from "@motion-mcp/scene-graph";
import type { MotionIntent } from "./intent.js";

export interface SynthPartOptions {
  /** Target part id for the generated tracks ("*" targets everything). */
  part: string;
  /** Part index drives temperament-scaled stagger offsets. */
  partIndex?: number;
}

export interface SynthOptions {
  temperament?: string | Partial<SceneTemperament>;
  /** Base duration before temperament/speed scaling. Recipes provide defaults. */
  durationMs?: number;
}

const BASE_DURATION_MS: Record<MotionIntent["action"], number> = {
  pulse: 3200,
  sway: 2800,
  blink: 4200,
  bounce: 900,
  spin: 1600,
  shake: 480,
  nod: 700,
  wave: 1400,
  jump: 1100,
  slide: 600
};

const SPEED_SCALE: Record<"fast" | "slow", number> = { fast: 0.7, slow: 1.35 };
const INTENSITY_SCALE: Record<"subtle" | "exaggerated", number> = { subtle: 0.6, exaggerated: 1.6 };

/**
 * Procedural motion synthesis: an intent plus a temperament profile become
 * concrete keyframes — easing curves, overshoot peaks, squash-and-stretch
 * pairs, and stagger are DERIVED from the temperament axes rather than
 * hardcoded per asset. Pure and deterministic.
 */
export function synthesizeClip(
  intent: MotionIntent,
  options: SynthOptions & SynthPartOptions
): SceneClip {
  const profile = temperamentProfile(resolveTemperament(options.temperament));
  const scale =
    (intent.speed ? SPEED_SCALE[intent.speed] : 1) *
    (intent.intensity ? INTENSITY_SCALE[intent.intensity] : 1);
  const base = options.durationMs ?? BASE_DURATION_MS[intent.action];
  const durationMs = Math.max(60, Math.round(base * scale * profile.durationScale));
  const amplitude = intensityFactor(intent) * amplitudeFor(intent.action);
  const staggerOffset = Math.round((options.partIndex ?? 0) * 45 * profile.staggerScale);

  const builder = RECIPE_BUILDERS[intent.action];
  let tracks = builder({ intent, durationMs, amplitude, profile });
  const part = options.part || "*";
  tracks = tracks.map((track) => ({ ...track, targetPart: part }));
  tracks = tracks.map((track) => shiftTrack(track, staggerOffset));
  if (intent.loop) {
    tracks = tracks.map((track) => closeLoop(track, durationMs + staggerOffset));
  } else if (profile.overshootPercent > 0) {
    tracks = tracks.map((track) => applyOvershoot(track, durationMs + staggerOffset, profile.overshootPercent / 100));
  }
  tracks = tracks.map((track) => retimeTrack(track, durationMs + staggerOffset));

  return {
    clipId: `clip-${intent.action}`,
    name: intent.action,
    durationMs: durationMs + staggerOffset,
    loop: intent.loop,
    tracks
  };
}

interface RecipeContext {
  intent: MotionIntent;
  durationMs: number;
  amplitude: number;
  profile: TemperamentMotionProfile;
}

type RecipeBuilder = (ctx: RecipeContext) => SceneTrack[];

const RECIPE_BUILDERS: Record<MotionIntent["action"], RecipeBuilder> = {
  pulse: ({ durationMs, amplitude, profile }) => [
    numericTrack("*", "scale", [
      key(0, 1),
      key(durationMs / 2, 1 + amplitude + warmthLift(profile), "easeInOut"),
      key(durationMs, 1)
    ]),
    numericTrack("*", "opacity", [
      key(0, 0.94 - amplitude * 0.5),
      key(durationMs / 2, 1, "easeInOut"),
      key(durationMs, 0.94 - amplitude * 0.5)
    ])
  ],

  bounce: ({ intent, durationMs, amplitude, profile }) => {
    const squash = clamp01(profile.squashStretch * 0.9);
    const groundTime = durationMs * 0.55;
    const apex = -amplitude * (1 + (profile.overshootPercent / 100) * 0.5);
    const tracks: SceneTrack[] = [
      numericTrack("*", "translateY", [
        key(0, 0),
        key(groundTime * 0.5, apex, profile.preferredEasing),
        key(groundTime, 0, "easeIn")
      ]),
      numericTrack("*", "scaleX", [
        key(groundTime - 30, 1),
        key(groundTime, 1 + squash, "easeOut"),
        key(groundTime + Math.max(40, durationMs * 0.12), 1, "easeInOut")
      ]),
      numericTrack("*", "scaleY", [
        key(groundTime - 30, 1),
        key(groundTime, 1 - squash, "easeOut"),
        key(groundTime + Math.max(40, durationMs * 0.12), 1, "easeInOut")
      ])
    ];
    if (!intent.loop) tracks[0]!.keys.push(key(durationMs, 0));
    return tracks;
  },

  spin: ({ intent, durationMs, profile }) => {
    const turns = intent.intensity === "exaggerated" ? 720 : 360;
    const direction = intent.direction === "left" ? -1 : 1;
    return [
      numericTrack(
        "*",
        "rotate",
        intent.loop
          ? [key(0, 0), key(durationMs, direction * turns)]
          : [
              key(0, 0),
              key(durationMs * 0.85, direction * turns, springOr(profile)),
              key(durationMs, direction * turns * 0.999)
            ]
      )
    ];
  },

  shake: ({ intent, durationMs, amplitude, profile }) => {
    const dir = intent.direction === "right" ? 1 : -1;
    const steps = 5;
    const span = durationMs / steps;
    const decay = intent.loop ? 1 : 0.72;
    const keys: SceneKeyframe[] = [key(0, 0)];
    for (let step = 1; step <= steps; step += 1) {
      const magnitude = amplitude * dir * Math.pow(decay, step - 1) * (step % 2 === 0 ? -1 : 1);
      keys.push(key(span * step, step === steps && !intent.loop ? 0 : magnitude, shortEasing(profile)));
    }
    return [numericTrack("*", "translateX", keys)];
  },

  nod: ({ durationMs, amplitude, profile }) => [
    numericTrack("*", "rotate", [
      key(0, 0),
      key(durationMs * 0.35, amplitude * 6, profile.preferredEasing),
      key(durationMs * 0.7, amplitude * 2, "easeInOut"),
      key(durationMs, 0, "easeOut")
    ])
  ],

  wave: ({ durationMs, amplitude, profile }) => [
    numericTrack("*", "rotate", [
      key(0, 0),
      key(durationMs * 0.25, amplitude * 10, profile.preferredEasing),
      key(durationMs * 0.5, -amplitude * 6, "easeInOut"),
      key(durationMs * 0.75, amplitude * 8, "easeInOut"),
      key(durationMs, 0, "easeOut")
    ])
  ],

  jump: ({ durationMs, amplitude, profile }) => {
    const squash = clamp01(profile.squashStretch);
    const anticipation = durationMs * 0.18;
    const apex = durationMs * 0.55;
    const land = durationMs * 0.78;
    return [
      numericTrack("*", "translateY", [
        key(0, 0),
        key(anticipation, amplitude * 0.08, "easeInOut"),
        key(apex, -amplitude, profile.preferredEasing),
        key(land, 0, "easeIn"),
        key(durationMs, 0, "easeOut")
      ]),
      numericTrack("*", "scaleY", [
        key(0, 1),
        key(anticipation, 1 - squash, "easeOut"),
        key(anticipation + (apex - anticipation) * 0.5, 1 + squash * 0.6, "easeInOut"),
        key(apex, 1.04, "easeInOut"),
        key(land, 1 - squash, "easeOut"),
        key(durationMs, 1, "easeInOut")
      ]),
      numericTrack("*", "scaleX", [
        key(0, 1),
        key(anticipation, 1 + squash * 0.7, "easeOut"),
        key(apex, 0.98, "easeInOut"),
        key(land, 1 + squash * 0.7, "easeOut"),
        key(durationMs, 1, "easeInOut")
      ])
    ];
  },

  sway: ({ durationMs, amplitude, profile }) => [
    numericTrack("*", "rotate", [
      key(0, 0),
      key(durationMs / 2, amplitude * 4, profile.preferredEasing),
      key(durationMs, 0)
    ]),
    numericTrack("*", "translateX", [
      key(0, 0),
      key(durationMs / 2, amplitude, profile.preferredEasing),
      key(durationMs, 0)
    ])
  ],

  blink: ({ durationMs, profile }) => {
    const shut = Math.max(60, durationMs * 0.12);
    return [
      numericTrack("*", "scaleY", [
        key(0, 1),
        key(shut, 0.08, "easeIn"),
        key(shut * 2, 1, "easeOut"),
        key(durationMs, 1)
      ])
    ];
  },

  slide: ({ intent, durationMs, amplitude, profile }) => {
    const sign = intent.direction === "left" || intent.direction === "up" ? -1 : 1;
    const axis = intent.direction === "up" || intent.direction === "down" ? "translateY" : "translateX";
    return [
      numericTrack("*", axis, [
        key(0, sign * amplitude * 6, "easeOut"),
        key(durationMs * 0.7, 0, profile.preferredEasing),
        key(durationMs, 0)
      ]),
      numericTrack("*", "opacity", [
        key(0, 0.4),
        key(durationMs * 0.4, 1, "easeOut"),
        key(durationMs, 1)
      ])
    ];
  }
};

function amplitudeFor(action: MotionIntent["action"]): number {
  switch (action) {
    case "bounce":
      return 14;
    case "jump":
      return 26;
    case "slide":
      return 6;
    case "sway":
      return 5;
    case "shake":
      return 4;
    case "pulse":
      return 0.05;
    default:
      return 1;
  }
}

function intensityFactor(intent: MotionIntent): number {
  return intent.intensity === "subtle" ? 0.6 : intent.intensity === "exaggerated" ? 1.6 : 1;
}

function warmthLift(profile: TemperamentMotionProfile): number {
  return Math.round((profile.secondaryAmplitude - 1) * 0.01 * 100) / 100;
}

function springOr(profile: TemperamentMotionProfile): SceneKeyframe["easing"] {
  return profile.preferredEasing === "easeOut" && profile.overshootPercent >= 4 ? "spring" : profile.preferredEasing;
}

function shortEasing(profile: TemperamentMotionProfile): SceneKeyframe["easing"] {
  return profile.preferredEasing;
}

function numericTrack(part: string, property: string, keys: SceneKeyframe[]): SceneTrack {
  return { targetPart: part, property, keys };
}

function key(t: number, value: number, easing?: SceneKeyframe["easing"]): SceneKeyframe {
  const rounded = Math.round(t);
  const precise = Math.round(value * 1000) / 1000;
  return easing ? { t: rounded, value: precise, easing } : { t: rounded, value: precise };
}

function shiftTrack(track: SceneTrack, offsetMs: number): SceneTrack {
  if (offsetMs === 0) return track;
  return { ...track, keys: track.keys.map((entry) => ({ ...entry, t: entry.t + offsetMs })) };
}

/** Guarantees loops sample seamlessly regardless of recipe rounding. */
function closeLoop(track: SceneTrack, totalMs: number): SceneTrack {
  const keys = [...track.keys];
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (typeof first.value !== "number" || typeof last.value !== "number") return track;
  if (Math.abs(first.value - last.value) > 1e-9) {
    keys[keys.length - 1] = { ...last, t: totalMs, value: first.value };
  } else if (last.t !== totalMs) {
    keys[keys.length - 1] = { ...last, t: totalMs };
  }
  return { ...track, keys };
}

/**
 * Injects a beyond-target peak into the final arrival segment so energetic
 * motion settles instead of stopping dead. No-op when there is nothing to
 * overshoot or the window is too small to read.
 */
function applyOvershoot(track: SceneTrack, totalMs: number, percent: number): SceneTrack {
  const keys = [...track.keys];
  if (keys.length < 2 || percent <= 0) return track;
  if (track.property === "rotate") return track;
  const last = keys[keys.length - 1]!;
  const previous = keys[keys.length - 2]!;
  if (typeof last.value !== "number" || typeof previous.value === "undefined") return track;
  if (Math.abs(last.t - previous.t) < 90) return track;
  if (typeof previous.value !== "number") return track;

  const delta = last.value - previous.value;
  if (Math.abs(delta) < 1e-6) return track;
  const peakValue = last.value + delta * percent * 0.5;
  const peakT = Math.round(last.t - Math.abs(last.t - previous.t) * 0.3);

  keys.splice(
    keys.length - 1,
    1,
    { t: peakT, value: round3(peakValue), easing: "easeOut" },
    { t: totalMs, value: last.value, easing: "easeInOut" }
  );
  return { ...track, keys };
}

/** Normalizes every key time into [0, totalMs] after stagger/overshoot edits. */
function retimeTrack(track: SceneTrack, totalMs: number): SceneTrack {
  const keys = track.keys
    .map((entry) => ({ ...entry, t: Math.min(entry.t, totalMs) }))
    .sort((a, b) => a.t - b.t);
  return { ...track, keys };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
