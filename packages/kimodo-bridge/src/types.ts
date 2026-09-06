export type SmplxJointName =
  | "pelvis"
  | "left_hip"
  | "right_hip"
  | "spine1"
  | "spine2"
  | "spine3"
  | "neck"
  | "head"
  | "left_shoulder"
  | "right_shoulder"
  | "left_elbow"
  | "right_elbow"
  | "left_wrist"
  | "right_wrist"
  | "left_hand"
  | "right_hand"
  | "left_knee"
  | "right_knee"
  | "left_ankle"
  | "right_ankle"
  | "left_foot"
  | "right_foot";

export interface SmplxJoint {
  name: SmplxJointName;
  index: number;
  parentIndex: number;
}

export interface SmplxSkeleton {
  joints: SmplxJoint[];
}

export interface JointRotation {
  jointIndex: number;
  jointName: string;
  quaternion: [number, number, number, number];
}

export interface SmplxFrame {
  frameIndex: number;
  rootTranslation: [number, number, number];
  jointRotations: JointRotation[];
}

export interface MotionSequenceMetadata {
  [key: string]: any;
}

export interface MotionSequence3D {
  sequenceId: string;
  prompt: string;
  fps: number;
  frameCount: number;
  durationMs: number;
  skeleton: SmplxSkeleton;
  frames: SmplxFrame[];
  metadata: MotionSequenceMetadata;
}

export interface Generate3DOptions {
  durationMs: number;
  steps?: number;
  fps?: number;
  seed?: number;
  temperature?: number;
}

export interface Motion3DModelInfo {
  id: string;
  name: string;
  backend: string;
  parameterCount?: number;
  fileSize: number;
  license?: string;
  capabilities: string[];
}

export interface BackendCapabilities {
  supportsEmbedding: boolean;
  maxDurationMs: number;
  supportedSkeletons: string[];
  gpuRequired: boolean;
}

export interface KimodoConfig {
  binaryPath: string;
  modelPath: string;
  device?: "cpu" | "vulkan" | "cuda" | "metal";
  chunkSize?: number;
  threads?: number;
}

export const SMPLX_SKELETON: SmplxSkeleton = {
  joints: [
    { name: "pelvis", index: 0, parentIndex: -1 },
    { name: "left_hip", index: 1, parentIndex: 0 },
    { name: "right_hip", index: 2, parentIndex: 0 },
    { name: "spine1", index: 3, parentIndex: 0 },
    { name: "left_knee", index: 4, parentIndex: 1 },
    { name: "right_knee", index: 5, parentIndex: 2 },
    { name: "spine2", index: 6, parentIndex: 3 },
    { name: "left_ankle", index: 7, parentIndex: 4 },
    { name: "right_ankle", index: 8, parentIndex: 5 },
    { name: "spine3", index: 9, parentIndex: 6 },
    { name: "left_foot", index: 10, parentIndex: 7 },
    { name: "right_foot", index: 11, parentIndex: 8 },
    { name: "neck", index: 12, parentIndex: 9 },
    { name: "left_shoulder", index: 13, parentIndex: 9 },
    { name: "right_shoulder", index: 14, parentIndex: 9 },
    { name: "head", index: 15, parentIndex: 12 },
    { name: "left_elbow", index: 16, parentIndex: 13 },
    { name: "right_elbow", index: 17, parentIndex: 14 },
    { name: "left_wrist", index: 18, parentIndex: 16 },
    { name: "right_wrist", index: 19, parentIndex: 17 },
    { name: "left_hand", index: 20, parentIndex: 18 },
    { name: "right_hand", index: 21, parentIndex: 19 },
  ],
};
