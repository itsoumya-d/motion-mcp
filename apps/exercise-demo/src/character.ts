import * as THREE from "three";
import { HUMANOID } from "@motion-mcp/motion-runtime";
import type { PoseSample } from "@motion-mcp/motion-runtime";

const DEG = Math.PI / 180;
const LIMB = 0x8aa2b8;
const TORSO = 0x5f7d95;
const ACCENT = 0xe8b04b;

interface BoneShape {
  kind: "capsule" | "box" | "sphere";
  len?: number;
  radius?: number;
  size?: [number, number, number];
  offset?: [number, number, number];
  color?: number;
}

function limb(len: number, radius = 0.045, color = LIMB): BoneShape {
  return { kind: "capsule", len, radius, color };
}

const SHAPES: Record<string, BoneShape[] | undefined> = {
  root: [{ kind: "box", size: [0.3, 0.16, 0.18], offset: [0, 0.02, 0], color: TORSO }],
  spine: [{ kind: "box", size: [0.26, 0.14, 0.16] }],
  chest: [{ kind: "box", size: [0.32, 0.18, 0.18], color: TORSO }],
  head: [{ kind: "sphere", radius: 0.095, offset: [0, 0.06, 0], color: ACCENT }],
  upperArmL: [limb(0.22)],
  forearmL: [limb(0.16)],
  handL: [{ kind: "sphere", radius: 0.04, color: ACCENT }],
  upperArmR: [limb(0.22)],
  forearmR: [limb(0.16)],
  handR: [{ kind: "sphere", radius: 0.04, color: ACCENT }],
  thighL: [limb(0.38, 0.05)],
  shinL: [limb(0.36, 0.04)],
  footL: [{ kind: "box", size: [0.07, 0.04, 0.15], offset: [0, -0.01, 0.05], color: ACCENT }],
  thighR: [limb(0.38, 0.05)],
  shinR: [limb(0.36, 0.04)],
  footR: [{ kind: "box", size: [0.07, 0.04, 0.15], offset: [0, -0.01, 0.05], color: ACCENT }]
};

export interface CharacterRig {
  group: THREE.Group;
  joints: Map<string, THREE.Object3D>;
  rest: Map<string, THREE.Vector3>;
}

export function buildCharacter(): CharacterRig {
  const group = new THREE.Group();
  const joints = new Map<string, THREE.Object3D>();
  const rest = new Map<string, THREE.Vector3>();
  const pivots = new Map<string, THREE.Object3D>();
  for (const spec of HUMANOID.joints) {
    const pivot = new THREE.Object3D();
    pivot.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
    const parentPivot = spec.parent ? pivots.get(spec.parent) : undefined;
    if (parentPivot) parentPivot.add(pivot);
    else group.add(pivot);
    pivots.set(spec.name, pivot);
    joints.set(spec.name, pivot);
    rest.set(spec.name, new THREE.Vector3(spec.offset[0], spec.offset[1], spec.offset[2]));
    for (const shape of SHAPES[spec.name] ?? []) pivot.add(makeMesh(shape));
  }
  return { group, joints, rest };
}

function makeMesh(shape: BoneShape): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  if (shape.kind === "capsule") {
    geometry = new THREE.CapsuleGeometry(shape.radius ?? 0.045, shape.len ?? 0.2, 4, 10);
  } else if (shape.kind === "sphere") {
    geometry = new THREE.SphereGeometry(shape.radius ?? 0.05, 18, 14);
  } else {
    const s = shape.size ?? [0.1, 0.1, 0.1];
    geometry = new THREE.BoxGeometry(s[0], s[1], s[2]);
  }
  const material = new THREE.MeshStandardMaterial({
    color: shape.color ?? LIMB,
    roughness: 0.72,
    metalness: 0.05
  });
  const mesh = new THREE.Mesh(geometry, material);
  if (shape.kind === "capsule" && shape.len) mesh.position.y = -(shape.len / 2 + (shape.radius ?? 0.045) * 0.4);
  if (shape.offset) mesh.position.set(shape.offset[0], shape.offset[1], shape.offset[2]);
  return mesh;
}

export function applyPose(rig: CharacterRig, sample: PoseSample): void {
  for (const [name, obj] of rig.joints) {
    const rot = sample.rotations[name];
    if (rot) obj.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG);
    else obj.rotation.set(0, 0, 0);
    const base = rig.rest.get(name)!;
    const tr = sample.translations[name];
    obj.position.set(
      base.x + (tr?.[0] ?? 0),
      base.y + (tr?.[1] ?? 0),
      base.z + (tr?.[2] ?? 0)
    );
  }
}
