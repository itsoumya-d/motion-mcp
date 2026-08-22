import assert from "node:assert/strict";
import test from "node:test";
import { EXERCISE_CATALOG, buildWorkoutPlan } from "../packages/motion-runtime/src/index.ts";

const sum = (steps: Array<{ durationMs: number }>) => steps.reduce((acc, s) => acc + s.durationMs, 0);

test("plans sum exactly to the requested budget", () => {
  for (const totalMs of [30000, 45000, 60000, 12345, 8000]) {
    const plan = buildWorkoutPlan({ totalMs });
    assert.equal(sum(plan), totalMs, `budget drift at ${totalMs}`);
    assert.ok(plan.length >= 1);
  }
});

test("planning is deterministic under a seed", () => {
  const a = buildWorkoutPlan({ totalMs: 60000, seed: 7 });
  const b = buildWorkoutPlan({ totalMs: 60000, seed: 7 });
  assert.deepEqual(a, b);
  const c = buildWorkoutPlan({ totalMs: 60000, seed: 8 });
  assert.notDeepEqual(a, c);
});

test("steps never repeat consecutively and respect focus filters", () => {
  const plan = buildWorkoutPlan({
    totalMs: 90000,
    focus: ["strength"],
    seed: 3,
    minStepMs: 10000,
    maxStepMs: 20000
  });
  for (let i = 1; i < plan.length; i += 1) {
    assert.notEqual(plan[i]!.exerciseId, plan[i - 1]!.exerciseId, `repeat at ${i}`);
  }
  const strengthIds = new Set(
    EXERCISE_CATALOG.filter((entry) => entry.category === "strength").map((entry) => entry.id)
  );
  for (const step of plan) {
    assert.ok(strengthIds.has(step.exerciseId), `${step.exerciseId} leaked outside focus`);
  }
});

test("last move is a mobility cool-down when the pool offers one", () => {
  const plan = buildWorkoutPlan({ totalMs: 60000, seed: 11 });
  const last = plan[plan.length - 1]!;
  const lastEntry = EXERCISE_CATALOG.find((entry) => entry.id === last.exerciseId)!;
  assert.equal(lastEntry.category, "mobility");
});

test("tiny budgets collapse to one move without crashing", () => {
  const plan = buildWorkoutPlan({ totalMs: 4000, minStepMs: 8000 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0]!.durationMs, 4000);
});
