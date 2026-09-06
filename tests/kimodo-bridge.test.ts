import assert from "node:assert/strict";
import test from "node:test";
import {
  MockBackend,
  BackendRegistry,
  SMPLX_SKELETON,
  eulerToQuaternion,
  quaternionToEuler,
  quaternionSlerp,
  quaternionMultiply,
  identityQuaternion,
  normalizeQuaternion,
  getDefaultModelDir,
  listLocalModels
} from "../packages/kimodo-bridge/src/index.ts";

test("kimodo-bridge: SMPL-X skeleton definition has 22 standard joints", () => {
  assert.equal(SMPLX_SKELETON.joints.length, 22);
  const names = SMPLX_SKELETON.joints.map((j) => j.name);
  assert.ok(names.includes("pelvis"));
  assert.ok(names.includes("left_knee"));
  assert.ok(names.includes("right_knee"));
  assert.ok(names.includes("head"));
  assert.ok(names.includes("left_wrist"));
  assert.ok(names.includes("right_wrist"));
});

test("kimodo-bridge: MockBackend generates valid 3D walk motion", async () => {
  const backend = new MockBackend();
  assert.equal(await backend.isAvailable(), true);

  const motion = await backend.generate("person walks forward confidently", {
    durationMs: 2000,
    fps: 30,
    seed: 42
  });

  assert.equal(motion.fps, 30);
  assert.equal(motion.frameCount, 60);
  assert.equal(motion.frames.length, 60);
  assert.equal(motion.skeleton.joints.length, 22);

  // Check forward translation in walk
  const firstFrame = motion.frames[0]!;
  const lastFrame = motion.frames[motion.frames.length - 1]!;
  assert.ok(lastFrame.rootTranslation[2] > firstFrame.rootTranslation[2], "Walk moves forward along Z");

  // Check all joints are present per frame
  for (const f of motion.frames) {
    assert.equal(f.jointRotations.length, 22);
    for (const jr of f.jointRotations) {
      const [x, y, z, w] = jr.quaternion;
      const lenSq = x * x + y * y + z * z + w * w;
      assert.ok(Math.abs(lenSq - 1.0) < 0.05, `Quaternion should be normalized, got lenSq=${lenSq}`);
    }
  }
});

test("kimodo-bridge: MockBackend generates waving animation on right arm", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("wave hello to the crowd", {
    durationMs: 1000,
    fps: 30
  });

  assert.equal(motion.frames.length, 30);
  const midFrame = motion.frames[15]!;
  const rShoulder = midFrame.jointRotations.find((jr) => jr.jointName === "right_shoulder");
  assert.ok(rShoulder, "Right shoulder joint present");
  // Waving raises arm (non-identity quaternion)
  assert.notDeepEqual(rShoulder?.quaternion, [0, 0, 0, 1]);
});

test("kimodo-bridge: pose codec quaternion utilities", () => {
  const ident = identityQuaternion();
  assert.deepEqual(ident, [0, 0, 0, 1]);

  // Euler ↔ Quaternion conversion
  const euler: [number, number, number] = [0, 90, 0];
  const q = eulerToQuaternion(euler);
  const back = quaternionToEuler(q);
  assert.ok(Math.abs(back[1] - 90) < 0.01, `Euler Y roundtrip: expected 90, got ${back[1]}`);

  // SLERP interpolation at t=0 and t=1
  const qA: [number, number, number, number] = [0, 0, 0, 1];
  const qB = eulerToQuaternion([45, 0, 0]);
  const slerp0 = quaternionSlerp(qA, qB, 0);
  const slerp1 = quaternionSlerp(qA, qB, 1);
  assert.ok(Math.abs(slerp0[3] - 1) < 0.001);
  assert.ok(Math.abs(slerp1[0] - qB[0]) < 0.001);

  // Normalize
  const norm = normalizeQuaternion([0, 2, 0, 0]);
  assert.deepEqual(norm, [0, 1, 0, 0]);
});

test("kimodo-bridge: BackendRegistry handles registration and lookup", async () => {
  const registry = new BackendRegistry();
  const mock = new MockBackend();
  registry.register(mock);

  assert.equal(registry.get("mock"), mock);
  assert.deepEqual(registry.list(), ["mock"]);
  const best = await registry.getBestAvailable();
  assert.equal(best.name, "mock");
});

test("kimodo-bridge: Model directory helper returns expected path", async () => {
  const dir = getDefaultModelDir();
  assert.ok(dir.includes(".motion-mcp"), "Default model directory inside .motion-mcp");
  const models = await listLocalModels(dir);
  assert.ok(Array.isArray(models));
});
