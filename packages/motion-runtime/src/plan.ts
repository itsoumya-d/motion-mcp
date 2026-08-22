import { EXERCISE_CATALOG } from "./exercises.js";
import type { ExerciseDef } from "./exercises.js";
import type { WorkoutStep } from "./workout.js";

export interface PlanOptions {
  totalMs: number;
  minStepMs?: number;
  maxStepMs?: number;
  focus?: Array<ExerciseDef["category"]>;
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledPool(focus: PlanOptions["focus"], rng: () => number): ExerciseDef[] {
  const base = EXERCISE_CATALOG.filter(
    (entry) => !focus || focus.includes(entry.category)
  );
  const pool = base.length > 0 ? base : [...EXERCISE_CATALOG];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = swap;
  }
  return pool;
}

function pickNext(pool: ExerciseDef[], previousId: string | undefined, cursor: number): ExerciseDef {
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const candidate = pool[(cursor + attempt) % pool.length]!;
    if (candidate.id !== previousId) return candidate;
  }
  return pool[cursor % pool.length]!;
}

/**
 * Deterministic workout composition from the exercise catalog.
 *
 * Guarantees: steps never repeat consecutively, every duration is within
 * [minStepMs..maxStepMs] whenever the budget allows at least one such block,
 * and the durations always sum to exactly totalMs. The last move becomes a
 * mobility cool-down whenever the filtered pool contains one.
 */
export function buildWorkoutPlan(options: PlanOptions): WorkoutStep[] {
  const totalMs = Math.max(Math.floor(options.totalMs), 1000);
  const minStepMs = Math.max(1000, options.minStepMs ?? 8000);
  const maxStepMs = Math.max(minStepMs, options.maxStepMs ?? 25000);
  const rng = mulberry32(options.seed ?? 20260822);

  const pool = shuffledPool(options.focus, rng);
  if (totalMs < minStepMs) {
    return [{ exerciseId: pickNext(pool, undefined, 0).id, durationMs: totalMs }];
  }

  const avgTarget = (minStepMs + maxStepMs) / 2;
  const targetSteps = Math.max(
    1,
    Math.min(Math.round(totalMs / avgTarget), pool.length * 4)
  );

  const base = Math.floor(totalMs / targetSteps);
  const extras = totalMs - base * targetSteps;

  const steps: WorkoutStep[] = [];
  let cursor = 0;
  for (let i = 0; i < targetSteps; i += 1) {
    const entry = pickNext(pool, steps[steps.length - 1]?.exerciseId, cursor);
    cursor += 1;
    steps.push({ exerciseId: entry.id, durationMs: base + (i < extras ? 1 : 0) });
  }

  const coolDown = [...pool].reverse().find((entry) => entry.category === "mobility");
  const last = steps[steps.length - 1]!;
  const previous = steps[steps.length - 2];
  if (
    coolDown &&
    last.exerciseId !== coolDown.id &&
    (!previous || previous.exerciseId !== coolDown.id)
  ) {
    steps[steps.length - 1] = { ...last, exerciseId: coolDown.id };
  }
  return steps;
}
