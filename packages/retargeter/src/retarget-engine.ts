import type { MotionSequence3D } from "@motion-mcp/shared-types";
import type { SceneClip, SceneBone, SceneTrack, SceneKeyframe } from "@motion-mcp/scene-graph";
import type { JointMapping, RetargetOptions } from "./types.js";
import { smoothMotion } from "./motion-cleanup.js";

export function retargetMotion(
  motion: MotionSequence3D,
  targetBones: SceneBone[],
  mapping: JointMapping,
  options?: RetargetOptions
): SceneClip[] {
  const fps = motion.fps || 30;
  const clipId = `clip_retargeted_${Date.now()}`;
  const frameCount = motion.frameCount || motion.frames.length || 1;
  const durationMs = motion.durationMs || (frameCount / fps) * 1000;

  let processedMotion = motion;
  if (options?.smoothingPasses && options.smoothingPasses > 0) {
    for (let i = 0; i < options.smoothingPasses; i++) {
      processedMotion = smoothMotion(processedMotion, 3);
    }
  }

  const tracks: SceneTrack[] = [];

  // Map source joints to target bones
  for (const [srcJoint, targetBoneId] of Object.entries(mapping.map)) {
    if (!targetBoneId) continue;
    const keys: SceneKeyframe[] = [];

    for (const frame of processedMotion.frames) {
      const jr = frame.jointRotations.find((r) => r.jointName === srcJoint);
      if (!jr) continue;
      keys.push({
        t: frame.frameIndex / frameCount,
        value: [...jr.quaternion],
        easing: "linear"
      });
    }

    if (keys.length > 0) {
      tracks.push({
        targetPart: targetBoneId,
        property: "quaternion",
        keys
      });
    }
  }

  // Preserve root motion if requested and available
  if (options?.preserveRootMotion !== false) {
    const rootBone = targetBones.find((b) => !b.parentBoneId) || targetBones[0];
    if (rootBone) {
      const hasRoot = processedMotion.frames.some(
        (f) => f.rootTranslation[0] !== 0 || f.rootTranslation[1] !== 0 || f.rootTranslation[2] !== 0
      );
      if (hasRoot) {
        tracks.push({
          targetPart: rootBone.boneId,
          property: "translateX",
          keys: processedMotion.frames.map((f) => ({
            t: f.frameIndex / frameCount,
            value: f.rootTranslation[0],
            easing: "linear" as const
          }))
        });
        tracks.push({
          targetPart: rootBone.boneId,
          property: "translateY",
          keys: processedMotion.frames.map((f) => ({
            t: f.frameIndex / frameCount,
            value: f.rootTranslation[1],
            easing: "linear" as const
          }))
        });
        tracks.push({
          targetPart: rootBone.boneId,
          property: "translateZ",
          keys: processedMotion.frames.map((f) => ({
            t: f.frameIndex / frameCount,
            value: f.rootTranslation[2],
            easing: "linear" as const
          }))
        });
      }
    }
  }

  return [
    {
      clipId,
      name: `${motion.prompt || "retargeted"}_clip`,
      durationMs,
      loop: false,
      tracks
    }
  ];
}
