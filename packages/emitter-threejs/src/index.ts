import type { SceneArtboard } from "@motion-mcp/scene-graph";
import type { FileChange, MotionPlanItem, GenerateAnimationOptions, AssetInfo } from "@motion-mcp/shared-types";
import { emitR3fAnimation } from "./emit-r3f.js";
import { emitVanillaThreejsAnimation } from "./emit-vanilla.js";

export { emitR3fAnimation } from "./emit-r3f.js";
export { emitVanillaThreejsAnimation } from "./emit-vanilla.js";

export function emitThreejsAnimation(input: {
  planItem: MotionPlanItem;
  asset?: AssetInfo;
  options: GenerateAnimationOptions;
  scene?: SceneArtboard;
}): FileChange[] {
  const framework = input.options.framework ?? input.planItem.framework;
  if (framework === "r3f" || framework === "react" || framework === "next") {
    return emitR3fAnimation(input);
  }
  return emitVanillaThreejsAnimation(input);
}
