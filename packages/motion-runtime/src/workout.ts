export interface WorkoutStep {
  exerciseId: string;
  durationMs: number;
}

export interface WorkoutState {
  steps: WorkoutStep[];
  index: number;
  phase: "idle" | "active" | "done";
  stepStartedAtMs: number;
}

export interface WorkoutTickResult {
  state: WorkoutState;
  startedExerciseId: string | null;
  finished: boolean;
}

export function createWorkout(steps: WorkoutStep[]): WorkoutState {
  return { steps, index: -1, phase: "idle", stepStartedAtMs: 0 };
}

export function beginWorkout(state: WorkoutState, nowMs: number): WorkoutState {
  if (state.steps.length === 0) return { ...state, phase: "done" };
  return { ...state, phase: "active", index: 0, stepStartedAtMs: nowMs };
}

export function tickWorkout(state: WorkoutState, nowMs: number): WorkoutTickResult {
  if (state.phase !== "active") {
    return { state, startedExerciseId: null, finished: false };
  }
  const step = state.steps[state.index];
  if (!step) {
    return { state: { ...state, phase: "done" }, startedExerciseId: null, finished: true };
  }
  if (nowMs - state.stepStartedAtMs < step.durationMs) {
    return { state, startedExerciseId: null, finished: false };
  }
  if (state.index + 1 >= state.steps.length) {
    return { state: { ...state, phase: "done" }, startedExerciseId: null, finished: true };
  }
  const next: WorkoutState = {
    ...state,
    index: state.index + 1,
    stepStartedAtMs: state.stepStartedAtMs + step.durationMs
  };
  return { state: next, startedExerciseId: next.steps[next.index]!.exerciseId, finished: false };
}

export function workoutRemainingMs(state: WorkoutState, nowMs: number): number {
  if (state.phase !== "active") return 0;
  const step = state.steps[state.index];
  if (!step) return 0;
  return Math.max(step.durationMs - (nowMs - state.stepStartedAtMs), 0);
}

export function workoutStatusLabel(
  state: WorkoutState,
  labels: (exerciseId: string) => string,
  nowMs: number
): string | null {
  if (state.phase === "idle") return null;
  if (state.phase === "done") return "Workout complete";
  const step = state.steps[state.index];
  if (!step) return null;
  const seconds = Math.ceil(workoutRemainingMs(state, nowMs) / 1000);
  return `Move ${state.index + 1}/${state.steps.length} · ${labels(step.exerciseId)} · ${seconds}s`;
}
