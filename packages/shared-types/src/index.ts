export type FrameworkKind =
  | "react"
  | "next"
  | "react-native"
  | "expo"
  | "flutter"
  | "unity"
  | "unknown";

export type AnimationRuntime =
  | "framer-motion"
  | "gsap"
  | "css"
  | "reanimated"
  | "moti"
  | "react-native-svg"
  | "flutter-animation"
  | "custom-painter"
  | "dotween"
  | "unity-animator"
  | "rive"
  | "lottie"
  | "none";

export type AssetType = "svg" | "lottie" | "rive" | "image" | "unknown";

export type AssetLane = "simple" | "premium";

export type FlowKind =
  | "onboarding"
  | "auth"
  | "dashboard"
  | "creation"
  | "checkout"
  | "success"
  | "error"
  | "settings"
  | "game-loop"
  | "reward-loop"
  | "generic";

export type MotionPropertyType =
  | "boolean"
  | "number"
  | "string"
  | "color"
  | "enum"
  | "trigger"
  | "image"
  | "object";

export type SvgModelId = "arrow-1.1" | "arrow-1.1-max" | (string & {});

export type MotionOperation =
  | "scan_codebase"
  | "scan_assets"
  | "auto_research_motion"
  | "research_app_motion"
  | "research_state_machine_experience"
  | "plan_screen_motion"
  | "estimate_asset_lane"
  | "ingest_svg_asset"
  | "generate_simple_svg_asset"
  | "generate_premium_svg_asset"
  | "plan_microinteractions"
  | "generate_animation"
  | "generate_svg_asset"
  | "vectorize_asset"
  | "validate";

export type MotionState =
  | "idle"
  | "hover"
  | "pressed"
  | "active"
  | "success"
  | "error"
  | "disabled";

export type MotionEvent =
  | "pointerEnter"
  | "pointerLeave"
  | "pressIn"
  | "pressOut"
  | "activate"
  | "success"
  | "error"
  | "reset";

export type MotionStateKind =
  | "entry"
  | "exit"
  | "any"
  | "single"
  | "blend1d"
  | "additiveBlend";

export type MotionInterpolation = "linear" | "cubic" | "hold" | "spring";

export type MotionConditionType = "boolean" | "number" | "trigger" | "enum" | "custom";

export type MotionConditionOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual";

export type MotionActionType = "setProperty" | "reportEvent" | "focus" | "fireCallback";

export type MotionListenerType = "pointer" | "press" | "scroll" | "route" | "visibility" | "form" | "game";

export type MotionCodegenTarget = "react" | "react-native" | "flutter" | "unity" | "spec-only";

export interface DependencyMap {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

export interface ComponentFile {
  id: string;
  path: string;
  framework: FrameworkKind;
  exportedComponents: string[];
  localComponents: string[];
  usesSvg: boolean;
  usesImage: boolean;
  usesLottie: boolean;
  usesRive: boolean;
  usesIconLibrary: boolean;
  detectedElements: string[];
  imports: string[];
}

export interface CodebaseScanResult {
  rootPath: string;
  framework: FrameworkKind;
  frameworks: FrameworkKind[];
  deps: DependencyMap;
  animationLibsPresent: AnimationRuntime[];
  componentFiles: ComponentFile[];
  entryPoints: string[];
  warnings: string[];
  scannedAt: string;
}

export interface SvgNodeInfo {
  nodeId: string;
  tag: string;
  id?: string;
  className?: string;
  roleGuess: string;
  attrs: Record<string, string>;
  semanticLabel?: string;
  children: SvgNodeInfo[];
}

export interface AssetInfo {
  id: string;
  path: string;
  type: AssetType;
  source?: "existing" | "quiver" | "vectorized" | "generated";
  dimensions?: {
    width?: number;
    height?: number;
    viewBox?: string;
  };
  pathTree?: SvgNodeInfo[];
  semanticLabels: string[];
  lottieLayers?: string[];
  sizeBytes: number;
}

export interface AssetIndexResult {
  rootPath: string;
  assets: AssetInfo[];
  indexPath: string;
  scannedAt: string;
  warnings: string[];
}

export type MotionStyle = "playful" | "minimal" | "corporate" | "naughty" | "luxury";

export type MotionTrigger =
  | "hover"
  | "tap"
  | "press"
  | "scroll"
  | "idle"
  | "success"
  | "error"
  | "drag"
  | "focus";

export interface ProjectConcept {
  conceptId: string;
  logoSvgPath?: string;
  brandConcept: string;
  brandPersonality: string[];
  savedAt: string;
}

export interface MotionScreen {
  screenId: string;
  path: string;
  name: string;
  framework: FrameworkKind;
  flowId: string;
  routePattern?: string;
  componentIds: string[];
  signals: string[];
}

export interface AppFlow {
  flowId: string;
  kind: FlowKind;
  name: string;
  screenIds: string[];
  confidence: number;
}

export interface MotionThesis {
  personality: string[];
  pacing: "calm" | "snappy" | "playful" | "cinematic";
  emotionalMoments: string[];
  restraintRules: string[];
  motionGrammar: string[];
}

export interface AppMotionContext {
  contextId: string;
  rootPath: string;
  framework: FrameworkKind;
  frameworks: FrameworkKind[];
  screens: MotionScreen[];
  flows: AppFlow[];
  assetsSummary: {
    total: number;
    svg: number;
    lottie: number;
    rive: number;
    image: number;
  };
  brandConcept?: ProjectConcept;
  designTokens: {
    colors: string[];
    radiusHints: string[];
    spacingHints: string[];
  };
  motionThesis: MotionThesis;
  createdAt: string;
}

export interface MotionProperty {
  name: string;
  type: MotionPropertyType;
  defaultValue?: string | number | boolean;
  description: string;
  source: "app-state" | "route-state" | "form-state" | "game-state" | "design-token" | "motion";
}

export interface MotionBinding {
  property: string;
  targetPart: string;
  source: MotionProperty["source"];
  description: string;
}

export interface MotionViewModel {
  viewModelId: string;
  name: string;
  properties: MotionProperty[];
  boundScreenId?: string;
  boundComponentId?: string;
}

export interface MotionTransition {
  from: MotionState;
  to: MotionState;
  event: MotionEvent;
  condition?: string;
  action?: string;
}

export interface MotionStateMachine {
  stateMachineId: string;
  name: string;
  initialState: MotionState;
  states: MotionState[];
  events: MotionEvent[];
  transitions: MotionTransition[];
  bindings: MotionBinding[];
  viewModel: MotionViewModel;
}

export interface MotionTransitionTiming {
  durationMs: number;
  exitTime?: number;
  exitTimeUnit?: "seconds" | "percent";
  pauseWhenExiting?: boolean;
  interpolation: MotionInterpolation;
}

export interface MotionCondition {
  conditionId: string;
  type: MotionConditionType;
  property?: string;
  operator?: MotionConditionOperator;
  value?: string | number | boolean;
  expression?: string;
  description: string;
}

export interface MotionAction {
  actionId: string;
  type: MotionActionType;
  timing: "start" | "end";
  property?: string;
  value?: string | number | boolean;
  eventName?: string;
  callback?: string;
  description: string;
}

export interface MotionListener {
  listenerId: string;
  type: MotionListenerType;
  event: string;
  sends: string;
  targetPart?: string;
  description: string;
}

export interface MotionStateNode {
  stateId: string;
  name: string;
  kind: MotionStateKind;
  timeline?: string;
  loop?: boolean;
  playbackSpeed?: number;
  blendProperty?: string;
  blendRange?: {
    min: number;
    max: number;
  };
  additiveProperties?: string[];
  controlledParts: string[];
  description: string;
  readyForCodegen: boolean;
  specOnlyReason?: string;
}

export interface MotionLayer {
  layerId: string;
  name: string;
  order: number;
  priority: number;
  ownedParts: string[];
  initialStateId: string;
  states: MotionStateNode[];
  description: string;
}

export interface RiveLikeTransition {
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  layerId: string;
  event?: string;
  timing: MotionTransitionTiming;
  conditions: MotionCondition[];
  actions: MotionAction[];
  description: string;
  readyForCodegen: boolean;
  specOnlyReason?: string;
}

export interface StateMachineCodegenReadiness {
  readyForCodegen: boolean;
  target: MotionCodegenTarget;
  supportedFeatures: string[];
  unsupportedFeatures: string[];
  specOnlyReason?: string;
}

export interface PageStateMachineExperience {
  pageId: string;
  screenId?: string;
  file: string;
  routePattern?: string;
  framework: FrameworkKind;
  name: string;
  experienceSummary: string;
  restraintRules: string[];
  assetNeeds: string[];
  viewModel: MotionViewModel;
  layers: MotionLayer[];
  transitions: RiveLikeTransition[];
  listeners: MotionListener[];
  bindings: MotionBinding[];
  codegen: StateMachineCodegenReadiness;
}

export interface StateMachineExperienceResult {
  experienceId: string;
  rootPath: string;
  pages: PageStateMachineExperience[];
  summary: {
    totalPages: number;
    stableCodegenPages: number;
    betaSpecPages: number;
    specOnlyPages: number;
  };
  researchSources: string[];
  createdAt: string;
}

export type MotionResearchSourceKind =
  | "official-doc"
  | "repo"
  | "api-doc"
  | "platform-guideline"
  | "article"
  | "community-reference";

export interface MotionResearchSource {
  sourceId: string;
  title: string;
  url: string;
  kind: MotionResearchSourceKind;
  platforms: string[];
  topics: string[];
  summary: string;
  retrievedAt: string;
  confidence: number;
  license?: string;
}

export interface MotionResearchFinding {
  findingId: string;
  category: string;
  title: string;
  summary: string;
  sourceIds: string[];
  platforms: string[];
  implications: string[];
  confidence: number;
}

export interface MotionResearchScore {
  impact: number;
  sourceSupport: number;
  localFit: number;
  effort: number;
  verificationStrength: number;
  safety: number;
  total: number;
}

export interface MotionResearchOpportunity {
  opportunityId: string;
  title: string;
  summary: string;
  category: string;
  targetPlatform: string;
  framework?: FrameworkKind;
  file?: string;
  screenId?: string;
  flowId?: string;
  moment?: string;
  sourceIds: string[];
  localEvidence: string[];
  score: MotionResearchScore;
  recommendedToolSequence: string[];
  verificationCommands: string[];
  constraints: string[];
  contextPackId?: string;
}

export interface MotionResearchContextPack {
  contextPackId: string;
  purpose: string;
  rootPath: string;
  targetFrameworks: FrameworkKind[];
  selectedFiles: Array<{
    path: string;
    reason: string;
  }>;
  sourceIds: string[];
  localEvidence: string[];
  constraints: string[];
  recommendedToolSequence: string[];
  verificationCommands: string[];
  opportunityIds: string[];
}

export interface AutoResearchMotionResult {
  researchId: string;
  rootPath: string;
  brief?: string;
  sources: MotionResearchSource[];
  findings: MotionResearchFinding[];
  opportunities: MotionResearchOpportunity[];
  contextPacks: MotionResearchContextPack[];
  summary: {
    totalSources: number;
    totalFindings: number;
    totalOpportunities: number;
    topOpportunityId?: string;
    stableTargets: FrameworkKind[];
    betaTargets: FrameworkKind[];
  };
  createdAt: string;
}

export interface ScreenMotionOpportunity {
  opportunityId: string;
  screenId: string;
  flowId?: string;
  componentId?: string;
  file: string;
  moment: string;
  assetNeed: string;
  stateMachineNeed: string;
  lane: AssetLane;
  credits: number;
  risk: "low" | "medium" | "high";
  valueScore: number;
  whyItMatters: string;
  svgBrief: string;
  acceptanceChecklist: string[];
  viewModel: MotionViewModel;
  stateMachine: MotionStateMachine;
}

export interface MotionMapResult {
  mapId: string;
  rootPath: string;
  opportunities: ScreenMotionOpportunity[];
  totalEstimatedCredits: number;
  createdAt: string;
}

export interface AssetLaneDecision {
  lane: AssetLane;
  confidence: number;
  reason: string;
  estimatedCredits: number;
  recommendedModel?: SvgModelId;
  complexity: "low" | "medium" | "high";
  svgBrief: string;
  acceptanceChecklist: string[];
}

export interface MotionPlanItem {
  componentId: string;
  assetId?: string;
  file: string;
  framework: FrameworkKind;
  runtime: AnimationRuntime[];
  interactionIdea: string;
  whyItMatters: string;
  suggestedTrigger: MotionTrigger;
  premiumScore: number;
  estimatedCredits: number;
  complexity: "low" | "medium" | "high";
}

export interface MotionPlanResult {
  planId: string;
  rootPath: string;
  plan: MotionPlanItem[];
  totalEstimatedCredits: number;
  createdAt: string;
}

export interface FileChange {
  path: string;
  content: string;
  mode: "create" | "replace" | "append";
}

export interface GeneratedMotionDiff {
  diffId: string;
  rootPath: string;
  componentId: string;
  summary: string;
  framework: FrameworkKind;
  creditsConsumed: number;
  validationStatus: ValidationResult;
  files: FileChange[];
  unifiedDiff: string;
  createdAt: string;
}

export interface CreditBalance {
  credits: number;
  plan: "free" | "pro" | "team" | "enterprise" | "local-dev";
}

export interface CreditDebit {
  amount: number;
  reason: string;
  refId?: string;
}

export interface CreditReservation {
  reservationId: string;
  amount: number;
  reason: string;
  refId?: string;
  status: "reserved" | "committed" | "refunded";
  createdAt: string;
  completedAt?: string;
}

export interface SvgModelInfo {
  id: SvgModelId;
  name: string;
  pricingCredits: number;
  available: boolean;
  default?: boolean;
  maxQuality?: boolean;
}

export interface QuiverUsageRecord {
  id: string;
  operation: "generate_svg_asset" | "vectorize_asset" | "list_svg_models";
  model: SvgModelId;
  quiverPricingCredits: number;
  motionCreditsReserved: number;
  motionCreditsCommitted: number;
  requestId?: string;
  traceId?: string;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    reset?: string;
  };
  createdAt: string;
}

export interface GeneratedSvgAssetResult {
  diffId: string;
  asset: AssetInfo;
  model: SvgModelId;
  quiverPricingCredits: number;
  motionCreditsReserved: number;
  motionCreditsCommitted: number;
  reservationId: string;
  requestId?: string;
  previewUrl: string;
}

export interface SimpleSvgAssetBriefResult {
  lane: "simple";
  rootPath: string;
  assetBrief: string;
  placement?: string;
  svgPrompt: string;
  acceptanceChecklist: string[];
  nextTool: "ingest_svg_asset";
}

export interface MotionCostEstimate {
  operation: MotionOperation;
  model?: SvgModelId;
  quiverPricingCredits?: number;
  motionCredits: number;
  marginMultiplier: number;
  planItemId?: string;
  source: "live-model-price" | "fallback-model-price" | "plan-estimate" | "fixed-local-price";
}

export interface ValidationResult {
  ok: boolean;
  command?: string;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
  reason?: string;
}

export interface GenerateAnimationOptions {
  style?: MotionStyle;
  trigger?: MotionTrigger;
  framework?: FrameworkKind;
  intensity?: "subtle" | "expressive" | "hero";
}

export const STANDARD_MOTION_STATES: MotionState[] = [
  "idle",
  "hover",
  "pressed",
  "active",
  "success",
  "error",
  "disabled"
];

export const STANDARD_MOTION_EVENTS: MotionEvent[] = [
  "pointerEnter",
  "pointerLeave",
  "pressIn",
  "pressOut",
  "activate",
  "success",
  "error",
  "reset"
];

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableId(prefix: string, value: string): string {
  const hash = Array.from(value).reduce((acc, char) => {
    return (acc * 33 + char.charCodeAt(0)) >>> 0;
  }, 5381);
  return `${prefix}_${hash.toString(36)}`;
}
