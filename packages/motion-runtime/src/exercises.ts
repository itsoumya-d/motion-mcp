export interface RepWindowOptions {
  enterBelowDeg: number;
  exitAboveDeg: number;
  minPhaseMs?: number;
}

export interface ExerciseDef {
  id: string;
  label: string;
  category: "strength" | "cardio" | "mobility";
  difficulty: 1 | 2 | 3;
  cueText: string;
  countBy: "kneeAngle" | "tempo";
  repWindow?: RepWindowOptions;
  tempoBpm?: number;
}

export const EXERCISE_CATALOG: ExerciseDef[] = [
  {
    id: "squat",
    label: "Bodyweight Squat",
    category: "strength",
    difficulty: 1,
    cueText: "Hips back, chest tall, knees track over toes.",
    countBy: "kneeAngle",
    repWindow: { enterBelowDeg: 95, exitAboveDeg: 160, minPhaseMs: 300 }
  },
  {
    id: "baked-squat",
    label: "Bodyweight Squat",
    category: "strength",
    difficulty: 1,
    cueText: "Pipeline-baked variant of the squat.",
    countBy: "kneeAngle",
    repWindow: { enterBelowDeg: 95, exitAboveDeg: 160, minPhaseMs: 300 }
  },
  {
    id: "lunge",
    label: "Alternating Lunge",
    category: "strength",
    difficulty: 2,
    cueText: "Front shin vertical, back knee drops under the hip.",
    countBy: "kneeAngle",
    repWindow: { enterBelowDeg: 105, exitAboveDeg: 158, minPhaseMs: 320 }
  },
  {
    id: "jumping-jack",
    label: "Jumping Jacks",
    category: "cardio",
    difficulty: 1,
    cueText: "Full arm circles, land soft, steady rhythm.",
    countBy: "tempo",
    tempoBpm: 46
  },
  {
    id: "bicep-curl",
    label: "Bicep Curl",
    category: "strength",
    difficulty: 1,
    cueText: "Elbows pinned to ribs, no swinging.",
    countBy: "kneeAngle",
    repWindow: { enterBelowDeg: 78, exitAboveDeg: 150, minPhaseMs: 280 }
  },
  {
    id: "arm-circles",
    label: "Arm Circles",
    category: "mobility",
    difficulty: 1,
    cueText: "Big smooth circles, shoulders relaxed.",
    countBy: "tempo",
    tempoBpm: 33
  }
];

const CATALOG_BY_ID = new Map(EXERCISE_CATALOG.map((entry) => [entry.id, entry]));

export function exerciseById(id: string | null): ExerciseDef | undefined {
  return id ? CATALOG_BY_ID.get(id) : undefined;
}
