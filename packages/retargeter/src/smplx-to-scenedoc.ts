import type {
  SceneArtboard,
  SceneBone,
  SceneClip,
  SceneKeyframe,
  SceneRig,
  SceneTrack
} from "@motion-mcp/scene-graph";

// Types from kimodo-bridge — imported as structural types to avoid circular deps
interface SmplxJoint {
  name: string;
  index: number;
  parentIndex: number;
}

interface SmplxSkeleton {
  joints: SmplxJoint[];
}

interface JointRotation {
  jointIndex: number;
  jointName: string;
  quaternion: [number, number, number, number];
}

interface SmplxFrame {
  frameIndex: number;
  rootTranslation: [number, number, number];
  jointRotations: JointRotation[];
}

interface MotionSequence3D {
  sequenceId: string;
  prompt: string;
  fps: number;
  frameCount: number;
  durationMs: number;
  skeleton: SmplxSkeleton;
  frames: SmplxFrame[];
}

/**
 * Convert a 3D motion sequence into SceneDoc clips with quaternion and
 * position tracks for each joint. Each joint gets a dedicated track.
 */
export function motionToSceneClips(motion: MotionSequence3D): Record<string, SceneClip> {
  const fps = motion.fps || 30;
  const durationMs = motion.durationMs || (motion.frameCount / fps) * 1000;
  const tracks: SceneTrack[] = [];

  if (motion.frames.length === 0) {
    return {};
  }

  // Build a rotation track per joint using the "quaternion" property
  const jointNames = motion.frames[0]!.jointRotations.map((jr) => jr.jointName);

  for (const jointName of jointNames) {
    const keys: SceneKeyframe[] = [];
    for (const frame of motion.frames) {
      const jr = frame.jointRotations.find((r) => r.jointName === jointName);
      if (!jr) continue;
      keys.push({
        t: frame.frameIndex / motion.frameCount,
        value: [...jr.quaternion], // [x, y, z, w]
        easing: "linear"
      });
    }
    if (keys.length > 0) {
      tracks.push({
        targetPart: `bone_${jointName}`,
        property: "quaternion",
        keys
      });
    }
  }

  // Root translation tracks
  const hasRootMotion = motion.frames.some(
    (f) => f.rootTranslation[0] !== 0 || f.rootTranslation[1] !== 0 || f.rootTranslation[2] !== 0
  );
  if (hasRootMotion) {
    tracks.push({
      targetPart: "bone_pelvis",
      property: "translateX",
      keys: motion.frames.map((f) => ({
        t: f.frameIndex / motion.frameCount,
        value: f.rootTranslation[0],
        easing: "linear" as const
      }))
    });
    tracks.push({
      targetPart: "bone_pelvis",
      property: "translateY",
      keys: motion.frames.map((f) => ({
        t: f.frameIndex / motion.frameCount,
        value: f.rootTranslation[1],
        easing: "linear" as const
      }))
    });
    tracks.push({
      targetPart: "bone_pelvis",
      property: "translateZ",
      keys: motion.frames.map((f) => ({
        t: f.frameIndex / motion.frameCount,
        value: f.rootTranslation[2],
        easing: "linear" as const
      }))
    });
  }

  const clipId = `clip_3d_${Date.now()}`;
  return {
    [clipId]: {
      clipId,
      name: motion.prompt || "generated_motion",
      durationMs,
      loop: false,
      tracks
    }
  };
}

/**
 * Convert an SMPL-X skeleton definition into a SceneDoc SceneRig with
 * proper bone hierarchy, 3D origins, and metadata.
 */
export function motionToSceneRig(skeleton: SmplxSkeleton): SceneRig {
  const bones: SceneBone[] = skeleton.joints.map((joint) => {
    const parentJoint =
      joint.parentIndex >= 0
        ? skeleton.joints.find((j) => j.index === joint.parentIndex)
        : undefined;

    return {
      boneId: `bone_${joint.name}`,
      name: joint.name,
      parentBoneId: parentJoint ? `bone_${parentJoint.name}` : undefined,
      targetParts: [`part_${joint.name}`],
      origin: { x: 0, y: 0 },
      origin3d: { x: 0, y: 0, z: 0 },
      restRotation: [0, 0, 0, 1] as [number, number, number, number]
    };
  });

  return {
    speciesId: "smplx-humanoid",
    matchConfidence: 1.0,
    bones,
    ikChains: [
      {
        chainId: "ik_eye_lookat",
        name: "Eye Look-At",
        boneIds: ["bone_neck", "bone_head"],
        targetPart: "part_head",
        hint: "look-at"
      }
    ],
    secondaryMotion: [],
    skeletonType: "smplx",
    jointCount: skeleton.joints.length,
    rootMotion: true
  };
}

/**
 * Create a complete SceneDoc artboard from a 3D motion sequence,
 * including the rig, clips, and a basic state machine.
 */
export function motionToArtboard(motion: MotionSequence3D, name: string): SceneArtboard {
  const clips = motionToSceneClips(motion);
  const clipIds = Object.keys(clips);
  const rig = motionToSceneRig(motion.skeleton);

  const stateId = `state_${name.replace(/\s+/g, "_").toLowerCase()}`;

  return {
    artboardId: `artboard_3d_${Date.now()}`,
    name,
    is3d: true,
    sceneType: "3d",
    layers: [
      {
        layerId: "layer_body",
        name: "Body",
        order: 0,
        targetParts: rig.bones.map((b: SceneBone) => b.boneId),
        initialStateId: stateId
      }
    ],
    clips,
    stateMachines: [
      {
        stateMachineId: `sm_${name.replace(/\s+/g, "_").toLowerCase()}`,
        name: `${name} State Machine`,
        initialStateId: stateId,
        states: [
          {
            stateId,
            name,
            kind: "single",
            clipId: clipIds[0],
            loop: true,
            controlledParts: rig.bones.map((b: SceneBone) => b.boneId)
          }
        ],
        transitions: []
      }
    ],
    rig,
    bindings: [],
    listeners: [],
    audioEvents: [],
    camera: {
      position: [0, 1.5, 4],
      target: [0, 1, 0],
      fov: 50
    },
    environment: {
      skyColor: "#87CEEB",
      groundColor: "#8B7D6B",
      ambientIntensity: 0.6
    }
  };
}
