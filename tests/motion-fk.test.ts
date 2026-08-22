import assert from "node:assert/strict";
import test from "node:test";
import {
  HUMANOID,
  IDLE_CLIP,
  SQUAT_CLIP,
  sampleClip,
  worldJointPositions
} from "../packages/motion-runtime/src/index.ts";

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("rest pose places joints at accumulated offsets", () => {
  const rest = worldJointPositions(HUMANOID, { timeMs: 0, clipId: "t", rotations: {}, translations: {} });
  const rootY = HUMANOID.joints[0]!.offset[1];
  assert.ok(approx(rest.root![1], rootY));
  assert.ok(approx(rest.head![1] - rest.neck![1], HUMANOID.joints.find((j) => j.name === "head")!.offset[1]));
});

test("90-degree hip rotation swings the shin forward along -Z", () => {
  const world = worldJointPositions(HUMANOID, {
    timeMs: 0,
    clipId: "t",
    rotations: { thighL: [90, 0, 0] },
    translations: {}
  });
  const dx = world.shinL![0] - world.thighL![0];
  const dy = world.shinL![1] - world.thighL![1];
  const dz = world.shinL![2] - world.thighL![2];
  assert.ok(approx(dx, 0, 1e-6) && approx(dy, 0, 1e-6), `expected horizontal swing, got ${dx},${dy}`);
  assert.ok(approx(dz, -0.42), `shin should extend toward -Z, got ${dz}`);
});

test("root translation moves the whole body", () => {
  const bottom = sampleClip(SQUAT_CLIP, 1500);
  const standing = sampleClip(SQUAT_CLIP, 100);
  const a = worldJointPositions(HUMANOID, bottom);
  const b = worldJointPositions(HUMANOID, standing);
  const dip = a.root![1] - b.root![1];
  assert.ok(dip < -0.3, `squat bottom must sit lower, got ${dip}`);
  const headDriftX = Math.abs((a.head![0] - b.head![0]) - (a.root![0] - b.root![0]));
  assert.ok(headDriftX < 1e-6, "rigid vertical drop must not shear the head sideways");
});

test("idle breathing stays within centimeters of rest", () => {
  const idlePose = sampleClip(IDLE_CLIP, 1700);
  const idle = worldJointPositions(HUMANOID, idlePose);
  const rest = worldJointPositions(HUMANOID, { timeMs: 0, clipId: "i", rotations: {}, translations: {} });
  for (const joint of HUMANOID.joints) {
    const d = Math.hypot(
      idle[joint.name]![0] - rest[joint.name]![0],
      idle[joint.name]![1] - rest[joint.name]![1],
      idle[joint.name]![2] - rest[joint.name]![2]
    );
    assert.ok(d < 0.08, `${joint.name} moved ${d.toFixed(3)}m during idle breathe`);
  }
});
