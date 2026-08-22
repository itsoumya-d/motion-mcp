import type { PoseSample, SkeletonSpec, Vec3 } from "./types.js";

const DEG = Math.PI / 180;

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

function identity(): Mat3 {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
}

/** Matches the renderer convention used by the web demo (three.js Euler 'XYZ'). */
function matFromEuler(rad: Vec3): Mat3 {
  const [rx, ry, rz] = rad;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const mx: Mat3 = [
    [1, 0, 0],
    [0, cx, -sx],
    [0, sx, cx]
  ];
  const my: Mat3 = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy]
  ];
  const mz: Mat3 = [
    [cz, -sz, 0],
    [sz, cz, 0],
    [0, 0, 1]
  ];
  return mulMat(mulMat(mx, my), mz);
}

function mulMat(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function applyMat(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}

/**
 * Forward kinematics: sampled local rotations + translations -> world joint
 * positions in meters. Joint specs must be ordered parents-first (HUMANOID is).
 */
export function worldJointPositions(
  skeleton: SkeletonSpec,
  sample: PoseSample
): Record<string, Vec3> {
  const worldRot = new Map<string, Mat3>();
  const worldPos = new Map<string, Vec3>();
  for (const joint of skeleton.joints) {
    const euler = sample.rotations[joint.name];
    const local = matFromEuler([
      (euler?.[0] ?? 0) * DEG,
      (euler?.[1] ?? 0) * DEG,
      (euler?.[2] ?? 0) * DEG
    ]);
    const parentMatrix = joint.parent ? worldRot.get(joint.parent) : undefined;
    const world = parentMatrix ? mulMat(parentMatrix, local) : local;
    worldRot.set(joint.name, world);

    const offsetWorld = parentMatrix ? applyMat(parentMatrix, joint.offset) : joint.offset;
    const parentPoint = joint.parent ? worldPos.get(joint.parent)! : ([0, 0, 0] as Vec3);
    const translation = sample.translations[joint.name];
    worldPos.set(joint.name, [
      parentPoint[0] + offsetWorld[0] + (translation?.[0] ?? 0),
      parentPoint[1] + offsetWorld[1] + (translation?.[1] ?? 0),
      parentPoint[2] + offsetWorld[2] + (translation?.[2] ?? 0)
    ]);
  }
  const result: Record<string, Vec3> = {};
  for (const [name, point] of worldPos) result[name] = point;
  return result;
}
