export type Vec3 = [number, number, number];

export interface JointKey {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface JointTrack {
  keys: JointKey[];
  ease?: "linear" | "smooth";
}

export interface MotionClipMeta {
  exercise?: string;
  source?: "procedural" | "baked";
  generator?: string;
  difficulty?: number;
}

export interface MotionClip {
  id: string;
  durationMs: number;
  loop: boolean;
  tracks: Record<string, JointTrack>;
  translations?: Record<string, JointTrack>;
  meta?: MotionClipMeta;
}

export interface PoseSample {
  timeMs: number;
  clipId: string;
  rotations: Record<string, Vec3>;
  translations: Record<string, Vec3>;
}

export interface JointSpec {
  name: string;
  parent: string | null;
  offset: Vec3;
}

export interface SkeletonSpec {
  id: string;
  joints: JointSpec[];
}

export type ExerciseStateName = "idle" | "exercising" | "cheering" | "correcting";

export interface ExerciseState {
  name: ExerciseStateName;
  exerciseId: string | null;
  repCount: number;
  stateEnteredAtMs: number;
  lastEventMs: number;
}

export type ExerciseEvent =
  | { type: "start"; exerciseId: string; atMs: number }
  | { type: "rep"; atMs: number }
  | { type: "formWarning"; atMs: number }
  | { type: "stop"; atMs: number };

export interface ExerciseCommand {
  baseClipId: string | null;
  overlayClipId: string | null;
  repCount: number;
  statusText: string;
}
