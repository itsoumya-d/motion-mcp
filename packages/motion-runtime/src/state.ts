import type { ExerciseCommand, ExerciseEvent, ExerciseState } from "./types.js";

export const OVERLAY_MS: Record<"cheering" | "correcting", number> = {
  cheering: 1100,
  correcting: 900
};

export const CLIP_IDS = {
  idle: "idle-breathe",
  cheer: "cheer",
  correct: "correct-form"
} as const;

export function initialExerciseState(nowMs = 0): ExerciseState {
  return { name: "idle", exerciseId: null, repCount: 0, stateEnteredAtMs: nowMs, lastEventMs: nowMs };
}

export function reduceExercise(state: ExerciseState, event: ExerciseEvent): ExerciseState {
  switch (event.type) {
    case "start":
      return {
        name: "exercising",
        exerciseId: event.exerciseId,
        repCount: 0,
        stateEnteredAtMs: event.atMs,
        lastEventMs: event.atMs
      };
    case "stop":
      return { ...state, name: "idle", exerciseId: null, stateEnteredAtMs: event.atMs, lastEventMs: event.atMs };
    case "rep": {
      if (!state.exerciseId) return state;
      return {
        ...state,
        name: "cheering",
        repCount: state.repCount + 1,
        stateEnteredAtMs: event.atMs,
        lastEventMs: event.atMs
      };
    }
    case "formWarning": {
      if (!state.exerciseId) return state;
      if (state.name === "correcting") return state;
      return { ...state, name: "correcting", stateEnteredAtMs: event.atMs, lastEventMs: event.atMs };
    }
    default:
      return state;
  }
}

export function tickExercise(state: ExerciseState, nowMs: number): ExerciseState {
  if (state.name === "cheering" || state.name === "correcting") {
    const duration = OVERLAY_MS[state.name];
    if (nowMs - state.stateEnteredAtMs >= duration) {
      return { ...state, name: "exercising", stateEnteredAtMs: nowMs };
    }
  }
  return state;
}

export function commandFor(state: ExerciseState): ExerciseCommand {
  const baseClipId =
    state.name === "idle" || !state.exerciseId ? CLIP_IDS.idle : state.exerciseId;
  const overlayClipId =
    state.name === "cheering" ? CLIP_IDS.cheer : state.name === "correcting" ? CLIP_IDS.correct : null;
  const statusText = buildStatusText(state);
  return { baseClipId, overlayClipId, repCount: state.repCount, statusText };
}

function buildStatusText(state: ExerciseState): string {
  switch (state.name) {
    case "idle":
      return "Idle — pick an exercise to begin";
    case "exercising":
      return `${labelOf(state.exerciseId)} — ${state.repCount} ${state.repCount === 1 ? "rep" : "reps"}`;
    case "cheering":
      return `Rep complete! Total: ${state.repCount}`;
    case "correcting":
      return "Form warning — check your depth and tempo";
  }
}

function labelOf(exerciseId: string | null): string {
  if (!exerciseId) return "Exercise";
  return exerciseId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
