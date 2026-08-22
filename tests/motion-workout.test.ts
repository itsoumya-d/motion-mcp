import assert from "node:assert/strict";
import test from "node:test";
import {
  EXERCISE_CATALOG,
  RepDepthTracker,
  beginWorkout,
  createWorkout,
  tickWorkout,
  workoutRemainingMs,
  workoutStatusLabel
} from "../packages/motion-runtime/src/index.ts";
import type { WorkoutState } from "../packages/motion-runtime/src/index.ts";

const STEPS = [
  { exerciseId: "squat", durationMs: 10000 },
  { exerciseId: "lunge", durationMs: 10000 },
  { exerciseId: "arm-circles", durationMs: 10000 }
];

test("exercise catalog is internally consistent", () => {
  const ids = EXERCISE_CATALOG.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const entry of EXERCISE_CATALOG) {
    if (entry.countBy === "kneeAngle") {
      assert.ok(entry.repWindow, `${entry.id} counts by knee angle but has no repWindow`);
      assert.ok(entry.repWindow.enterBelowDeg < entry.repWindow.exitAboveDeg);
    }
    if (entry.countBy === "tempo") {
      assert.ok((entry.tempoBpm ?? 0) > 0, `${entry.id} counts by tempo but has no tempoBpm`);
    }
  }
});

test("workout sequencer advances across step boundaries", () => {
  let workout = beginWorkout(createWorkout(STEPS), 0);
  let result = tickWorkout(workout, 9999);
  workout = result.state;
  assert.equal(workout.index, 0);
  assert.equal(result.startedExerciseId, null);

  result = tickWorkout(workout, 10001);
  workout = result.state;
  assert.equal(result.startedExerciseId, "lunge");
  assert.equal(workout.index, 1);

  const label = workoutStatusLabel(
    workout,
    (id) => (id === "lunge" ? "Alternating Lunge" : id),
    15000
  );
  assert.match(label ?? "", /Move 2\/3/);
  assert.match(label ?? "", /5s/);

  result = tickWorkout(workout, 30001);
  workout = result.state;
  assert.equal(result.startedExerciseId, "arm-circles", "boundary crossing reports the next move");
  assert.equal(result.finished, false);

  result = tickWorkout(workout, 30001);
  assert.equal(result.finished, true);
  assert.equal(result.state.phase, "done");
});

test("long frames advance one step per tick until finished", () => {
  let workout: WorkoutState = beginWorkout(createWorkout(STEPS), 0);
  let ticks = 0;
  let finished = false;
  while (ticks < 10) {
    const result = tickWorkout(workout, 60000);
    workout = result.state;
    ticks += 1;
    if (result.finished) {
      finished = true;
      break;
    }
    assert.ok(result.startedExerciseId, "each advancing tick must report its new step");
  }
  assert.equal(finished, true, "must finish within a bounded number of ticks");
  assert.ok(ticks <= STEPS.length + 1, `finished in ${ticks} ticks`);
  assert.equal(workoutRemainingMs(workout, 60000), 0);
});

test("idle workouts never tick and empty workouts finish on begin", () => {
  const idle = createWorkout(STEPS);
  const untouched = tickWorkout(idle, 999999);
  assert.equal(untouched.finished, false);
  assert.equal(untouched.state.phase, "idle");

  const empty = beginWorkout(createWorkout([]), 0);
  assert.equal(empty.phase, "done");
});

test("rep depth tracker flags shallow reps between closes", () => {
  const tracker = new RepDepthTracker(100);
  tracker.sample(170);
  tracker.sample(120);
  tracker.sample(115);
  assert.equal(tracker.close(), true, "never dipped below 100 -> shallow");

  assert.equal(tracker.close(), false, "close without samples is never shallow");

  tracker.sample(170);
  tracker.sample(80);
  tracker.sample(165);
  assert.equal(tracker.close(), false, "deep rep passes the check");
  assert.equal(tracker.wasShallow, false);
});
