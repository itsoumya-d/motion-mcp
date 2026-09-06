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
  /** Optional character rig (SceneDoc v1 extension — backward compatible). */
  rig?: SceneRig;
  /** Optional personality parameters driving procedural motion style (SceneDoc v1 extension). */
  temperament?: SceneTemperament;
  /** Whether this artboard contains 3D content (SceneDoc v1 3D extension). */
  is3d?: boolean;
  /** Artboard content type (SceneDoc v1 3D extension). */
  sceneType?: "2d" | "3d" | "hybrid";
  /** Camera configuration for 3D scenes (SceneDoc v1 3D extension). */
  camera?: SceneCamera;
  /** Environment settings for 3D scenes (SceneDoc v1 3D extension). */
  environment?: SceneEnvironment;
}

/**
 * Personality primitive: four axes in [0,1] that procedurally shape easing,
 * overshoot, squash/stretch, and secondary motion for any rigged asset.
 * SceneDoc v1 additive extension — resolved by resolveTemperament().
 */
export interface SceneTemperament {
  /** Pace and snap. High = fast, springy, punchy. Low = slow, languid. */
  energy: number;
  /** Mass illusion. High = heavy landings, deep squash, low overshoot. Low = floaty. */
  weight: number;
  /** Ambient liveliness. High = strong breathe/sway/blink secondary motion. */
  warmth: number;
  /** Mechanical tightness. High = minimal stagger, easeInOut bias, no overshoot. */
  precision: number;
}

/**
 * Character-rig block. Emitted by the auto-rigger (anatomy-engine) and
 * consumed by emitters/runtimes that support skeletal driving.
 */
export interface SceneRig {
  speciesId?: string;
  matchConfidence?: number;
  bones: SceneBone[];
  ikChains: SceneIkChain[];
  secondaryMotion: SceneSecondaryMotion[];
  /** Skeleton type identifier (SceneDoc v1 3D extension). */
  skeletonType?: "smplx" | "mixamo" | "ue-mannequin" | "custom" | "inferred";
  /** Total joint count in the source skeleton (SceneDoc v1 3D extension). */
  jointCount?: number;
  /** Whether the motion includes root translation data (SceneDoc v1 3D extension). */
  rootMotion?: boolean;
}

export interface SceneBone {
  boneId: string;
  name: string;
  parentBoneId?: string;
  /** Part ids this bone drives. */
  targetParts: string[];
  /** Joint origin in artboard coordinates (2D). */
  origin: { x: number; y: number };
  /** Joint origin in 3D world coordinates (SceneDoc v1 3D extension). */
  origin3d?: { x: number; y: number; z: number };
  length?: number;
  /** Bone length in 3D world units (SceneDoc v1 3D extension). */
  length3d?: number;
  restRotationDeg?: number;
  /** Rest pose rotation as quaternion [x, y, z, w] (SceneDoc v1 3D extension). */
  restRotation?: [number, number, number, number];
  /** Per-part influence in [0,1] (auto-weight output; SceneDoc v1 extension). */
  weights?: Record<string, number>;
}

export interface SceneIkChain {
  chainId: string;
  name: string;
  boneIds: string[];
  targetPart: string;
  hint?: "two-bone" | "look-at";
}

export interface SceneSecondaryMotion {
  partId: string;
  kind: "breathe" | "sway" | "bob" | "blink" | "follow" | "spring";
  amount: number;
  periodMs: number;
  phaseMs?: number;
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
  | "y"
  // 3D extensions (SceneDoc v1 additive — backward compatible)
  | "translateZ"
  | "rotateX"
  | "rotateY"
  | "rotateZ"
  | "quaternion"
  | "scaleZ";

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

/**
 * Camera configuration for 3D artboards (SceneDoc v1 3D extension).
 */
export interface SceneCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  near?: number;
  far?: number;
}

/**
 * Environment settings for 3D scenes (SceneDoc v1 3D extension).
 */
export interface SceneEnvironment {
  skyColor?: string;
  groundColor?: string;
  ambientIntensity?: number;
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
