import type { MotionSequence3D, SmplxSkeleton } from "@motion-mcp/shared-types";
import type { SceneClip, SceneRig, SceneBone, SceneArtboard } from "@motion-mcp/scene-graph";

export interface JointMap extends Record<string, string> {}

export interface JointMapping {
  map: JointMap;
  unmappedSource: string[];
  unmappedTarget: string[];
  confidence: number;
}

export interface RetargetOptions {
  jointMapping?: JointMapping;
  scaleCompensation?: boolean;
  preserveRootMotion?: boolean;
  smoothingPasses?: number;
  footIk?: boolean;
}

export interface CleanupOptions {
  smoothingWindow?: number;
  footSlideThreshold?: number;
  loopBlendFrames?: number;
  removeJitter?: boolean;
}

export interface BvhJoint {
  name: string;
  offset: [number, number, number];
  channels: string[];
  children: BvhJoint[];
}

export interface BvhData {
  hierarchy: BvhJoint;
  frameCount: number;
  frameTime: number;
  frames: number[][];
}
