import type {
  FrameworkKind,
  MotionAction,
  MotionBinding,
  MotionCondition,
  MotionInterpolation,
  MotionListener,
  MotionStateKind
} from "@motion-mcp/shared-types";

export const SCENE_FORMAT_VERSION = 1;

/**
 * SceneDoc is motion-mcp's unified, open scene interchange format.
 *
 * One JSON document spans both motion worlds that used to live apart:
 * Rive-like UI state machines (states/transitions/bindings) and keyframed
 * character clips (MotionDoc). Everything in the pipeline consumes or
 * produces SceneDocs: researchers write them, emitters read them, the
 * player plays them, importers fill them.
 */
export interface SceneDoc {
  formatVersion: typeof SCENE_FORMAT_VERSION;
  sceneId: string;
  name: string;
  createdAt: string;
  canvas?: {
    width?: number;
    height?: number;
    viewBox?: string;
  };
  artboards: SceneArtboard[];
}

export interface SceneArtboard {
  artboardId: string;
  name: string;
  sourceFile?: string;
  screenId?: string;
  routePattern?: string;
  framework?: FrameworkKind;
  experienceSummary?: string;
  restraintRules?: string[];
  layers: SceneLayer[];
  clips: Record<string, SceneClip>;
  stateMachines: SceneStateMachine[];
  bindings: MotionBinding[];
  listeners: MotionListener[];
  audioEvents: SceneAudioEvent[];
  semantics?: SceneSemantics;
}

export interface SceneLayer {
  layerId: string;
  name: string;
  order: number;
  priority?: number;
  /** SVG part ids/names this layer drives. */
  targetParts: string[];
  initialStateId?: string;
}

export interface SceneClip {
  clipId: string;
  name: string;
  durationMs: number;
  loop: boolean;
  tracks: SceneTrack[];
}

export interface SceneTrack {
  /** Part id, or "*" for the whole layer/artboard. */
  targetPart: string;
  property: SceneProperty | (string & {});
  keys: SceneKeyframe[];
}

export type SceneProperty =
  | "opacity"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "rotate"
  | "translateX"
  | "translateY"
  | "pathLength"
  | "fill"
  | "stroke"
  | "strokeWidth"
  | "x"
  | "y";

export interface SceneKeyframe {
  t: number;
  value: number | string | number[];
  easing?: SceneEasing;
}

export type SceneEasing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold" | "spring";

export interface SceneState {
  stateId: string;
  name: string;
  kind: MotionStateKind;
  clipId?: string;
  loop?: boolean;
  playbackSpeed?: number;
  blendProperty?: string;
  blendRange?: { min: number; max: number };
  controlledParts: string[];
}

export interface SceneTransition {
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  event?: string;
  durationMs: number;
  interpolation: MotionInterpolation;
  exitTimeMs?: number;
  conditions: MotionCondition[];
  actions: MotionAction[];
}

export interface SceneStateMachine {
  stateMachineId: string;
  name: string;
  initialStateId: string;
  layerId?: string;
  states: SceneState[];
  transitions: SceneTransition[];
}

export interface SceneAudioEvent {
  eventId: string;
  atMs: number;
  clipName: string;
  volume?: number;
  description?: string;
}

export interface SceneSemantics {
  label?: string;
  role?: string;
  live?: "off" | "polite" | "assertive";
  reducedMotionSafe?: boolean;
}

export function emptySceneDoc(sceneId: string, name: string): SceneDoc {
  return {
    formatVersion: SCENE_FORMAT_VERSION,
    sceneId,
    name,
    createdAt: new Date().toISOString(),
    artboards: []
  };
}
