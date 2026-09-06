import type { SceneRig, SceneBone } from "@motion-mcp/scene-graph";
import type { ThreejsEmitOptions } from "./types.js";

/**
 * Generates code to build a THREE.Skeleton from a SceneRig.
 */
export function buildSkeletonCode(rig: SceneRig, options: ThreejsEmitOptions): string {
  if (!rig || !rig.bones || rig.bones.length === 0) {
    return `  // No skeleton/bones defined in rig\n  const skeleton = new THREE.Skeleton([]);\n`;
  }

  let code = `  // Build Skeleton\n`;
  code += `  const bones: THREE.Bone[] = [];\n`;
  code += `  const boneMap = new Map<string, THREE.Bone>();\n\n`;

  // First pass: Create all bones
  for (const bone of rig.bones) {
    const boneVar = `bone_${bone.boneId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    code += `  const ${boneVar} = new THREE.Bone();\n`;
    code += `  ${boneVar}.name = "${bone.boneId}";\n`;
    if (bone.origin3d) {
      code += `  ${boneVar}.position.set(${bone.origin3d.x}, ${bone.origin3d.y}, ${bone.origin3d.z});\n`;
    }
    if (bone.restRotation) {
      code += `  ${boneVar}.quaternion.set(${bone.restRotation[0]}, ${bone.restRotation[1]}, ${bone.restRotation[2]}, ${bone.restRotation[3]});\n`;
    }
    code += `  bones.push(${boneVar});\n`;
    code += `  boneMap.set("${bone.boneId}", ${boneVar});\n\n`;
  }

  // Second pass: Establish hierarchy
  code += `  // Establish Hierarchy\n`;
  for (const bone of rig.bones) {
    if (bone.parentBoneId) {
      const childVar = `boneMap.get("${bone.boneId}")`;
      const parentVar = `boneMap.get("${bone.parentBoneId}")`;
      code += `  if (${parentVar} && ${childVar}) {\n`;
      code += `    ${parentVar}.add(${childVar});\n`;
      code += `  }\n`;
    }
  }

  code += `\n  const skeleton = new THREE.Skeleton(bones);\n`;

  return code;
}
