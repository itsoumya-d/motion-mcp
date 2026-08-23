export {
  analyzeArtboardMotion,
  analyzeSceneMotion,
  scoreChecks
} from "./checks.js";
export type { CritiqueCheck, CritiqueSeverity, MotionCritique } from "./checks.js";
export { critiqueRenderedOutput, critiqueScene } from "./render.js";
export type { RenderCheckResult, RenderCritiqueOptions } from "./render.js";
export { autoFixScene, critiqueWithAutoFix } from "./autofix.js";
export type { AutoFixResult } from "./autofix.js";
