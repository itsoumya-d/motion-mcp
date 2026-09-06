import assert from "node:assert/strict";
import test from "node:test";
import { MockBackend } from "../packages/kimodo-bridge/src/index.ts";
import {
  motionToArtboard,
  motionToSceneClips,
  motionToSceneRig,
  retargetMotion,
  autoMapJoints,
  parseBvh,
  bvhToMotionSequence,
  motionSequenceToBvh,
  smoothMotion,
  blendLoop,
  SMPLX_TO_MIXAMO,
  SMPLX_TO_UNITY_HUMANOID
} from "../packages/retargeter/src/index.ts";
import { validateSceneDoc } from "../packages/scene-graph/src/index.ts";

test("retargeter: motionToArtboard produces a valid 3D SceneDoc artboard", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("walk forward", { durationMs: 1500, fps: 30 });

  const artboard = motionToArtboard(motion, "Walk Character");
  assert.equal(artboard.is3d, true);
  assert.equal(artboard.sceneType, "3d");
  assert.ok(artboard.rig, "Rig should be present");
  assert.equal(artboard.rig?.skeletonType, "smplx");
  assert.equal(artboard.rig?.bones.length, 22);
  assert.ok(artboard.camera, "Camera settings present");
  assert.ok(artboard.environment, "Environment settings present");

  // Validate as full SceneDoc
  const doc = {
    formatVersion: 1 as const,
    sceneId: "scene_3d_test",
    name: "3D Scene Test",
    createdAt: new Date().toISOString(),
    artboards: [artboard]
  };
  const validation = validateSceneDoc(doc);
  assert.equal(validation.ok, true, `Validation failed: ${validation.errors.join(", ")}`);
});

test("retargeter: motionToSceneClips extracts per-joint quaternion tracks", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("idle breathe", { durationMs: 1000, fps: 30 });

  const clips = motionToSceneClips(motion);
  const clipList = Object.values(clips);
  assert.equal(clipList.length, 1);
  const clip = clipList[0]!;
  assert.equal(clip.tracks.length, 22, "22 joint rotation tracks");

  const neckTrack = clip.tracks.find((t) => t.targetPart === "bone_neck");
  assert.ok(neckTrack, "Neck track exists");
  assert.equal(neckTrack?.property, "quaternion");
  assert.equal(neckTrack?.keys.length, 30, "30 keyframes for 1s at 30fps");
});

test("retargeter: retargetMotion transfers SMPL-X motion to target rig", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("walk", { durationMs: 1000, fps: 30 });

  const targetBones = [
    { boneId: "mixamo_hips", name: "Hips", origin: { x: 0, y: 0 }, targetParts: ["hips"] },
    { boneId: "mixamo_spine", name: "Spine", parentBoneId: "mixamo_hips", origin: { x: 0, y: 0 }, targetParts: ["spine"] },
    { boneId: "mixamo_head", name: "Head", parentBoneId: "mixamo_spine", origin: { x: 0, y: 0 }, targetParts: ["head"] }
  ];

  const mapping = {
    map: {
      pelvis: "mixamo_hips",
      spine1: "mixamo_spine",
      head: "mixamo_head"
    },
    unmappedSource: [],
    unmappedTarget: [],
    confidence: 0.9
  };

  const clips = retargetMotion(motion, targetBones, mapping, {
    smoothingPasses: 1,
    preserveRootMotion: true
  });

  assert.equal(clips.length, 1);
  const clip = clips[0]!;
  assert.ok(clip.tracks.length >= 3, "At least 3 mapped tracks");
  assert.ok(clip.tracks.some((t) => t.targetPart === "mixamo_head"));
  assert.ok(clip.tracks.some((t) => t.targetPart === "mixamo_hips"));
});

test("retargeter: BVH codec parses and serializes motion", () => {
  const sampleBvh = `HIERARCHY
ROOT Hips
{
  OFFSET 0.00 0.00 0.00
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT Spine
  {
    OFFSET 0.00 10.00 0.00
    CHANNELS 3 Zrotation Xrotation Yrotation
    End Site
    {
      OFFSET 0.00 5.00 0.00
    }
  }
}
MOTION
Frames: 2
Frame Time: 0.033333
0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
0.0 0.5 1.0 0.0 0.0 0.0 0.0 0.0 0.0
`;

  const parsed = parseBvh(sampleBvh);
  assert.equal(parsed.frameCount, 2);
  assert.equal(parsed.hierarchy.name, "Hips");
  assert.equal(parsed.hierarchy.children.length, 1);
  assert.equal(parsed.hierarchy.children[0]?.name, "Spine");

  const motion = bvhToMotionSequence(parsed);
  assert.equal(motion.frameCount, 2);
  assert.equal(motion.fps, 30);

  const exported = motionSequenceToBvh(motion);
  assert.ok(exported.includes("HIERARCHY"));
  assert.ok(exported.includes("MOTION"));
  assert.ok(exported.includes("Frames: 2"));
});

test("retargeter: smoothMotion and blendLoop post-process motion", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("jump", { durationMs: 1000, fps: 30 });

  const smoothed = smoothMotion(motion, 5);
  assert.equal(smoothed.frames.length, motion.frames.length);

  const looped = blendLoop(motion, 5);
  assert.equal(looped.frames.length, motion.frames.length);
});
