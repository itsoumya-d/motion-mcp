export {
  analyzeArtboardMotion,
  analyzeSceneMotion,
  scoreChecks
} from "./checks.js";
export type { CritiqueCheck, CritiqueSeverity, MotionCritique } from "./checks.js";
export { critiqueRenderedOutput, critiqueScene } from "./render.js";
export type { CritiqueOptions, RenderCheckResult, RenderCritiqueOptions } from "./render.js";
export { autoFixScene, autoFixTrack, critiqueWithAutoFix } from "./autofix.js";
export type { AutoFixOptions, AutoFixResult } from "./autofix.js";
export {
  DEFAULT_RUBRIC,
  checkConfig,
  loadRubric,
  mergeRubric,
  REPAIR_FIXES,
  RUBRIC_CHECK_IDS
} from "./rubric.js";
export type {
  CurveLintConfig,
  JudgeRubricConfig,
  MotionRubric,
  RepairRubricConfig,
  RenderRubricConfig,
  RubricBoundsRule,
  RubricCheckConfig,
  RubricCheckId,
  RubricSeverity
} from "./rubric.js";
export { lintCurves } from "./curve-lint.js";
export { MockJudgeProvider, judgeRenderedFrames, resolveJudgeProvider } from "./judge.js";
export { ClaudeVisionJudge, GeminiVisionJudge } from "./judge-live.js";
export type { DecodedFrameInput, JudgeContext, JudgeProvider, JudgeVerdict } from "./judge.js";
export { runRepairLoop } from "./repair-loop.js";
export type { RepairAttempt, RepairLoopOptions, RepairLoopResult } from "./repair-loop.js";
