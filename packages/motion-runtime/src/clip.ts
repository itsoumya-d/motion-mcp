import type { JointKey, JointTrack, MotionClip, PoseSample, Vec3 } from "./types.js";

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

function sortedKeys(track: JointTrack): JointKey[] {
  return [...track.keys].sort((a, b) => a.t - b.t);
}

export function sampleTrack(track: JointTrack, tMs: number): Vec3 {
  const keys = track.keys;
  if (keys.length === 0) return [0, 0, 0];
  const first = keys[0]!;
  if (keys.length === 1 || tMs <= first.t) return [first.x, first.y, first.z];
  const last = keys[keys.length - 1]!;
  if (tMs >= last.t) return [last.x, last.y, last.z];
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= tMs) lo = mid;
    else hi = mid;
  }
  const k0 = keys[lo]!;
  const k1 = keys[hi]!;
  const span = Math.max(k1.t - k0.t, 1e-6);
  let u = (tMs - k0.t) / span;
  if ((track.ease ?? "smooth") === "smooth") u = smoothstep(u);
  return [
    k0.x + (k1.x - k0.x) * u,
    k0.y + (k1.y - k0.y) * u,
    k0.z + (k1.z - k0.z) * u
  ];
}

export function localTime(clip: MotionClip, elapsedMs: number): number {
  if (!clip.loop) return Math.min(Math.max(elapsedMs, 0), clip.durationMs);
  const wrapped = elapsedMs % clip.durationMs;
  return wrapped < 0 ? wrapped + clip.durationMs : wrapped;
}

export function sampleClip(clip: MotionClip, elapsedMs: number): PoseSample {
  const t = localTime(clip, elapsedMs);
  const rotations: Record<string, Vec3> = {};
  for (const [joint, track] of Object.entries(clip.tracks)) {
    rotations[joint] = sampleTrack(track, t);
  }
  const translations: Record<string, Vec3> = {};
  if (clip.translations) {
    for (const [joint, track] of Object.entries(clip.translations)) {
      translations[joint] = sampleTrack(track, t);
    }
  }
  return { timeMs: t, clipId: clip.id, rotations, translations };
}

interface ClipDef {
  id: string;
  durationMs: number;
  loop: boolean;
  tracks: Record<string, Array<[number, number, number, number]>>;
  translations?: Record<string, Array<[number, number, number, number]>>;
  meta?: MotionClip["meta"];
}

function toTrack(raw: Array<[number, number, number, number]>): JointTrack {
  return { keys: raw.map(([t, x, y, z]) => ({ t, x, y, z })).sort((a, b) => a.t - b.t), ease: "smooth" };
}

export function buildClip(def: ClipDef): MotionClip {
  const tracks: Record<string, JointTrack> = {};
  for (const [joint, keys] of Object.entries(def.tracks)) tracks[joint] = toTrack(keys);
  const translations: Record<string, JointTrack> | undefined = def.translations
    ? Object.fromEntries(Object.entries(def.translations).map(([joint, keys]) => [joint, toTrack(keys)]))
    : undefined;
  return {
    id: def.id,
    durationMs: def.durationMs,
    loop: def.loop,
    tracks,
    translations,
    meta: def.meta ?? { source: "procedural", generator: "motion-runtime/clips" }
  };
}

export const IDLE_CLIP = buildClip({
  id: "idle-breathe",
  durationMs: 3400,
  loop: true,
  meta: { exercise: "idle", source: "procedural" },
  tracks: {
    spine: [
      [0, 0, 0, 0],
      [1700, 2.4, 0, 0],
      [3400, 0, 0, 0]
    ],
    chest: [
      [0, 0, 0, 0],
      [850, -1.6, 0, 0],
      [2550, 1.8, 0, 0],
      [3400, 0, 0, 0]
    ],
    upperArmL: [
      [0, 0, 0, 3],
      [1700, 0, 0, 5],
      [3400, 0, 0, 3]
    ],
    upperArmR: [
      [0, 0, 0, -3],
      [1700, 0, 0, -5],
      [3400, 0, 0, -3]
    ],
    head: [
      [0, 0, 0, 0],
      [1200, 3, 0, 0],
      [2600, -1, 0, 0],
      [3400, 0, 0, 0]
    ]
  }
});

export const SQUAT_CLIP = buildClip({
  id: "squat",
  durationMs: 2400,
  loop: true,
  meta: { exercise: "squat", difficulty: 2 },
  tracks: {
    thighL: [
      [0, 0, 0, 0],
      [900, 82, 0, -6],
      [1500, 84, 0, -6],
      [2400, 0, 0, 0]
    ],
    thighR: [
      [0, 0, 0, 0],
      [900, 82, 0, 6],
      [1500, 84, 0, 6],
      [2400, 0, 0, 0]
    ],
    shinL: [
      [0, 0, 0, 0],
      [900, -74, 0, 0],
      [1500, -76, 0, 0],
      [2400, 0, 0, 0]
    ],
    shinR: [
      [0, 0, 0, 0],
      [900, -74, 0, 0],
      [1500, -76, 0, 0],
      [2400, 0, 0, 0]
    ],
    spine: [
      [0, 0, 0, 0],
      [900, 16, 0, 0],
      [1500, 18, 0, 0],
      [2400, 0, 0, 0]
    ],
    upperArmL: [
      [0, 0, 0, 4],
      [900, 74, 0, 10],
      [1500, 76, 0, 10],
      [2400, 0, 0, 4]
    ],
    upperArmR: [
      [0, 0, 0, -4],
      [900, 74, 0, -10],
      [1500, 76, 0, -10],
      [2400, 0, 0, -4]
    ],
    forearmL: [
      [0, 0, 0, 0],
      [900, -18, 0, 0],
      [2400, 0, 0, 0]
    ],
    forearmR: [
      [0, 0, 0, 0],
      [900, -18, 0, 0],
      [2400, 0, 0, 0]
    ],
    head: [
      [0, 0, 0, 0],
      [900, -14, 0, 0],
      [2400, 0, 0, 0]
    ]
  },
  translations: {
    root: [
      [0, 0, 0, 0],
      [900, 0, -0.34, 0],
      [1500, 0, -0.36, 0],
      [2400, 0, 0, 0]
    ]
  }
});

export const JUMPING_JACK_CLIP = buildClip({
  id: "jumping-jack",
  durationMs: 1300,
  loop: true,
  meta: { exercise: "jumping-jack", difficulty: 2 },
  tracks: {
    upperArmL: [
      [0, 0, 0, 6],
      [650, 0, 0, 168],
      [1300, 0, 0, 6]
    ],
    upperArmR: [
      [0, 0, 0, -6],
      [650, 0, 0, -168],
      [1300, 0, 0, -6]
    ],
    thighL: [
      [0, 0, 0, 0],
      [650, 0, 0, -22],
      [1300, 0, 0, 0]
    ],
    thighR: [
      [0, 0, 0, 0],
      [650, 0, 0, 22],
      [1300, 0, 0, 0]
    ],
    kneeHintL: [
      [0, 0, 0, 0],
      [650, -12, 0, 0],
      [1300, 0, 0, 0]
    ]
  },
  translations: {
    root: [
      [0, 0, 0, 0],
      [520, 0, 0.09, 0],
      [780, 0, 0.02, 0],
      [1300, 0, 0, 0]
    ]
  }
});

export const BICEP_CURL_CLIP = buildClip({
  id: "bicep-curl",
  durationMs: 1600,
  loop: true,
  meta: { exercise: "bicep-curl", difficulty: 1 },
  tracks: {
    upperArmL: [
      [0, 0, 0, 4],
      [1600, 0, 0, 4]
    ],
    upperArmR: [
      [0, 0, 0, -4],
      [1600, 0, 0, -4]
    ],
    forearmL: [
      [0, 0, 0, 0],
      [700, -128, 0, 0],
      [1600, 0, 0, 0]
    ],
    forearmR: [
      [0, 0, 0, 0],
      [700, -128, 0, 0],
      [1600, 0, 0, 0]
    ],
    chest: [
      [0, 0, 0, 0],
      [700, 2, 0, 0],
      [1600, 0, 0, 0]
    ]
  }
});

export const CHEER_CLIP = buildClip({
  id: "cheer",
  durationMs: 1100,
  loop: false,
  meta: { exercise: "cheer-overlay" },
  tracks: {
    upperArmL: [
      [0, 0, 0, 6],
      [300, 0, 0, 172],
      [600, 0, 0, 156],
      [1100, 0, 0, 172]
    ],
    upperArmR: [
      [0, 0, 0, -6],
      [300, 0, 0, -172],
      [600, 0, 0, -156],
      [1100, 0, 0, -172]
    ],
    head: [
      [0, 0, 0, 0],
      [350, -8, 0, 0],
      [800, 6, 0, 0],
      [1100, 0, 0, 0]
    ]
  },
  translations: {
    root: [
      [0, 0, 0, 0],
      [320, 0, 0.07, 0],
      [560, 0, -0.02, 0],
      [1100, 0, 0, 0]
    ]
  }
});

export const CORRECT_CLIP = buildClip({
  id: "correct-form",
  durationMs: 900,
  loop: false,
  meta: { exercise: "form-overlay" },
  tracks: {
    upperArmR: [
      [0, 0, 0, -6],
      [280, 86, 0, -12],
      [900, 0, 0, -6]
    ],
    forearmR: [
      [0, 0, 0, 0],
      [280, -96, 0, 0],
      [620, -60, 0, 0],
      [900, 0, 0, 0]
    ],
    head: [
      [0, 0, 0, 0],
      [240, 6, 8, 0],
      [480, 6, -8, 0],
      [720, 6, 8, 0],
      [900, 0, 0, 0]
    ]
  }
});

export const LUNGE_CLIP = buildClip({
  id: "lunge",
  durationMs: 2000,
  loop: true,
  meta: { exercise: "lunge", difficulty: 2 },
  tracks: {
    thighL: [
      [0, 0, 0, 0],
      [450, 68, 0, -4],
      [750, 72, 0, -4],
      [1000, 0, 0, 0],
      [1450, -24, 0, -4],
      [1750, -26, 0, -4],
      [2000, 0, 0, 0]
    ],
    thighR: [
      [0, 0, 0, 0],
      [450, -24, 0, 4],
      [750, -26, 0, 4],
      [1000, 0, 0, 0],
      [1450, 68, 0, 4],
      [1750, 72, 0, 4],
      [2000, 0, 0, 0]
    ],
    shinL: [
      [0, 0, 0, 0],
      [450, -58, 0, 0],
      [750, -62, 0, 0],
      [1000, 0, 0, 0],
      [1450, -8, 0, 0],
      [1750, -10, 0, 0],
      [2000, 0, 0, 0]
    ],
    shinR: [
      [0, 0, 0, 0],
      [450, -8, 0, 0],
      [750, -10, 0, 0],
      [1000, 0, 0, 0],
      [1450, -58, 0, 0],
      [1750, -62, 0, 0],
      [2000, 0, 0, 0]
    ],
    spine: [
      [0, 0, 0, 0],
      [600, 6, 0, 0],
      [1600, 6, 0, 0],
      [2000, 0, 0, 0]
    ],
    upperArmL: [
      [0, 0, 0, 4],
      [500, 0, 0, 16],
      [1000, 0, 0, 4],
      [1500, 0, 0, 16],
      [2000, 0, 0, 4]
    ],
    upperArmR: [
      [0, 0, 0, -4],
      [500, 0, 0, -16],
      [1000, 0, 0, -4],
      [1500, 0, 0, -16],
      [2000, 0, 0, -4]
    ],
    forearmL: [
      [0, 0, 0, 0],
      [500, -14, 0, 0],
      [1000, 0, 0, 0],
      [1500, -14, 0, 0],
      [2000, 0, 0, 0]
    ],
    forearmR: [
      [0, 0, 0, 0],
      [500, -14, 0, 0],
      [1000, 0, 0, 0],
      [1500, -14, 0, 0],
      [2000, 0, 0, 0]
    ]
  },
  translations: {
    root: [
      [0, 0, 0, 0],
      [600, 0, -0.18, 0],
      [850, 0, -0.2, 0],
      [1000, 0, 0, 0],
      [1600, 0, -0.18, 0],
      [1850, 0, -0.2, 0],
      [2000, 0, 0, 0]
    ]
  }
});

export const ARM_CIRCLES_CLIP = buildClip({
  id: "arm-circles",
  durationMs: 1800,
  loop: true,
  meta: { exercise: "arm-circles", difficulty: 1 },
  tracks: {
    upperArmL: [
      [0, 0, 0, 5],
      [900, 0, 0, 170],
      [1800, 0, 0, 5]
    ],
    upperArmR: [
      [0, 0, 0, -5],
      [900, 0, 0, -170],
      [1800, 0, 0, -5]
    ],
    forearmL: [
      [0, 0, 0, 0],
      [900, -12, 0, 0],
      [1800, 0, 0, 0]
    ],
    forearmR: [
      [0, 0, 0, 0],
      [900, -12, 0, 0],
      [1800, 0, 0, 0]
    ],
    chest: [
      [0, 0, 0, 0],
      [450, 0, 3, 0],
      [1350, 0, -3, 0],
      [1800, 0, 0, 0]
    ]
  }
});

export function defaultExerciseClips(): MotionClip[] {
  return [
    IDLE_CLIP,
    SQUAT_CLIP,
    LUNGE_CLIP,
    ARM_CIRCLES_CLIP,
    JUMPING_JACK_CLIP,
    BICEP_CURL_CLIP,
    CHEER_CLIP,
    CORRECT_CLIP
  ];
}
