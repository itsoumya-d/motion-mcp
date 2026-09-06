import type { SceneRig, SceneClip } from "@motion-mcp/scene-graph";
import type { ThreejsEmitOptions } from "./types.js";

/**
 * Generates Three.js AnimationClip code from SceneDoc clips.
 */
export function buildAnimationClipCode(
  clips: Record<string, SceneClip>,
  rig: SceneRig,
  options: ThreejsEmitOptions
): string {
  let code = `  // Build Animation Clips\n`;
  code += `  const clips: THREE.AnimationClip[] = [];\n\n`;

  for (const [clipId, clip] of Object.entries(clips)) {
    const clipVarName = `clip_${clipId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    code += `  const tracks_${clipVarName}: THREE.KeyframeTrack[] = [];\n`;

    for (const track of clip.tracks) {
      const partName = track.targetPart.replace(/^bone_/, "");
      const times = track.keys.map((k) => (k.t * (clip.durationMs / 1000)).toFixed(4)).join(", ");

      if (track.property === "quaternion") {
        const values = track.keys
          .flatMap((k) => {
            if (Array.isArray(k.value)) {
              return [k.value[0] ?? 0, k.value[1] ?? 0, k.value[2] ?? 0, k.value[3] ?? 1];
            }
            return [0, 0, 0, 1];
          })
          .map((n) => (typeof n === "number" ? n.toFixed(4) : "0"))
          .join(", ");

        code += `  tracks_${clipVarName}.push(new THREE.QuaternionKeyframeTrack("${partName}.quaternion", [${times}], [${values}]));\n`;
      } else if (
        track.property === "translateX" ||
        track.property === "translateY" ||
        track.property === "translateZ"
      ) {
        const axisIndex = track.property === "translateX" ? 0 : track.property === "translateY" ? 1 : 2;
        const values = track.keys
          .map((k) => (typeof k.value === "number" ? k.value.toFixed(4) : "0"))
          .join(", ");
        code += `  tracks_${clipVarName}.push(new THREE.NumberKeyframeTrack("${partName}.position[${axisIndex}]", [${times}], [${values}]));\n`;
      }
    }

    const duration = clip.durationMs ? clip.durationMs / 1000 : -1;
    code += `  const ${clipVarName} = new THREE.AnimationClip("${clip.name || clipId}", ${duration}, tracks_${clipVarName});\n`;
    code += `  clips.push(${clipVarName});\n\n`;
  }

  return code;
}
