import type { SkeletonSpec } from "./types.js";

export const HUMANOID: SkeletonSpec = {
  id: "humanoid-17",
  joints: [
    { name: "root", parent: null, offset: [0, 0.95, 0] },
    { name: "spine", parent: "root", offset: [0, 0.12, 0] },
    { name: "chest", parent: "spine", offset: [0, 0.14, 0] },
    { name: "neck", parent: "chest", offset: [0, 0.12, 0] },
    { name: "head", parent: "neck", offset: [0, 0.1, 0] },
    { name: "upperArmL", parent: "chest", offset: [-0.2, 0.06, 0] },
    { name: "forearmL", parent: "upperArmL", offset: [0, -0.24, 0] },
    { name: "handL", parent: "forearmL", offset: [0, -0.18, 0] },
    { name: "upperArmR", parent: "chest", offset: [0.2, 0.06, 0] },
    { name: "forearmR", parent: "upperArmR", offset: [0, -0.24, 0] },
    { name: "handR", parent: "forearmR", offset: [0, -0.18, 0] },
    { name: "thighL", parent: "root", offset: [-0.1, -0.05, 0] },
    { name: "shinL", parent: "thighL", offset: [0, -0.42, 0] },
    { name: "footL", parent: "shinL", offset: [0, -0.4, 0.04] },
    { name: "thighR", parent: "root", offset: [0.1, -0.05, 0] },
    { name: "shinR", parent: "thighR", offset: [0, -0.42, 0] },
    { name: "footR", parent: "shinR", offset: [0, -0.4, 0.04] }
  ]
};

export function jointNames(skeleton: SkeletonSpec): string[] {
  return skeleton.joints.map((joint) => joint.name);
}

export function jointIndex(skeleton: SkeletonSpec): Map<string, number> {
  return new Map(skeleton.joints.map((joint, index) => [joint.name, index]));
}
