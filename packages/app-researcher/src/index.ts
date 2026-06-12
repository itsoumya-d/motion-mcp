import { promises as fs } from "node:fs";
import path from "node:path";
import { scanAssets } from "@motion-mcp/asset-indexer";
import { scanCodebase } from "@motion-mcp/codebase-scanner";
import {
  STANDARD_MOTION_EVENTS,
  STANDARD_MOTION_STATES,
  type AppFlow,
  type AppMotionContext,
  type AssetIndexResult,
  type AssetLane,
  type AssetLaneDecision,
  type CodebaseScanResult,
  type ComponentFile,
  type FlowKind,
  type MotionBinding,
  type MotionMapResult,
  type MotionProperty,
  type MotionScreen,
  type MotionState,
  type MotionStateMachine,
  type MotionThesis,
  type MotionViewModel,
  type ProjectConcept,
  type ScreenMotionOpportunity,
  type SvgModelId,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";

export interface ResearchAppMotionInput {
  rootPath: string;
  brief?: string;
}

export interface PlanScreenMotionInput {
  rootPath: string;
  screenId?: string;
  flowId?: string;
}

export interface EstimateAssetLaneInput {
  rootPath: string;
  screenId: string;
  assetBrief: string;
}

export async function researchAppMotion(input: ResearchAppMotionInput): Promise<{
  context: AppMotionContext;
  motionMap: MotionMapResult;
}> {
  const root = path.resolve(input.rootPath);
  const scan = await loadOrScan(root);
  const assets = await loadOrIndex(root);
  const concept = await readMotionJson<ProjectConcept>(root, "concept.json");
  const screens = buildScreens(scan);
  const flows = buildFlows(screens);
  const context: AppMotionContext = {
    contextId: stableId("appctx", `${root}:${input.brief ?? ""}:${nowIso()}`),
    rootPath: root,
    framework: scan.framework,
    frameworks: scan.frameworks,
    screens,
    flows,
    assetsSummary: summarizeAssets(assets),
    brandConcept: concept,
    designTokens: await detectDesignTokens(root, scan),
    motionThesis: buildMotionThesis(scan, screens, concept, input.brief),
    createdAt: nowIso()
  };
  const motionMap = buildMotionMap(root, context, scan, assets, input.brief);
  await writeMotionJson(root, "app-context.json", context);
  await writeMotionJson(root, "motion-map.json", motionMap);
  return { context, motionMap };
}

export async function getAppMotionContext(rootPath: string): Promise<AppMotionContext> {
  const root = path.resolve(rootPath);
  const context = await readMotionJson<AppMotionContext>(root, "app-context.json");
  if (!context) {
    return (await researchAppMotion({ rootPath: root })).context;
  }
  return context;
}

export async function planScreenMotion(input: PlanScreenMotionInput): Promise<MotionMapResult> {
  const root = path.resolve(input.rootPath);
  const existing = await readMotionJson<MotionMapResult>(root, "motion-map.json");
  const context = await getAppMotionContext(root);
  const map = existing ?? (await researchAppMotion({ rootPath: root })).motionMap;
  let opportunities = map.opportunities
    .filter((item) => !input.screenId || item.screenId === input.screenId)
    .filter((item) => !input.flowId || item.flowId === input.flowId)
    .sort((a, b) => b.valueScore - a.valueScore)
    .slice(0, input.screenId || input.flowId ? 9 : Math.max(3, context.flows.length * 3));
  if (opportunities.length === 0 && input.screenId) {
    const scan = await loadOrScan(root);
    const assets = await loadOrIndex(root);
    const screen = context.screens.find((candidate) => candidate.screenId === input.screenId);
    const component = screen
      ? scan.componentFiles.find((candidate) => candidate.id === screen.componentIds[0])
      : undefined;
    opportunities = screen ? opportunityTemplates(screen, component, context, assets).sort((a, b) => b.valueScore - a.valueScore) : [];
  }
  return {
    ...map,
    opportunities,
    totalEstimatedCredits: opportunities.reduce((sum, item) => sum + item.credits, 0)
  };
}

export async function estimateAssetLane(input: EstimateAssetLaneInput): Promise<AssetLaneDecision> {
  const root = path.resolve(input.rootPath);
  const context = await getAppMotionContext(root);
  const screen = context.screens.find((candidate) => candidate.screenId === input.screenId);
  return decideAssetLane(input.assetBrief, screen, context);
}

function buildScreens(scan: CodebaseScanResult): MotionScreen[] {
  const screenCandidates = scan.componentFiles.filter((component) => isScreenLike(component, scan.entryPoints));
  const fallback = screenCandidates.length ? screenCandidates : scan.componentFiles.slice(0, 8);
  return fallback.map((component) => {
    const flowKind = flowKindForText(`${component.path} ${component.exportedComponents.join(" ")} ${component.localComponents.join(" ")}`);
    const flowId = stableId("flow", flowKind);
    return {
      screenId: stableId("screen", component.path),
      path: component.path,
      name: displayComponentName(component),
      framework: component.framework === "unknown" ? scan.framework : component.framework,
      flowId,
      routePattern: routePatternForPath(component.path),
      componentIds: [component.id],
      signals: screenSignals(component)
    };
  });
}

function buildFlows(screens: MotionScreen[]): AppFlow[] {
  const byFlow = new Map<string, MotionScreen[]>();
  for (const screen of screens) {
    byFlow.set(screen.flowId, [...(byFlow.get(screen.flowId) ?? []), screen]);
  }
  return Array.from(byFlow.entries()).map(([flowId, flowScreens]) => {
    const kind = flowKindForText(flowScreens.map((screen) => `${screen.path} ${screen.name} ${screen.signals.join(" ")}`).join(" "));
    return {
      flowId,
      kind,
      name: titleCase(kind.replace(/-/g, " ")),
      screenIds: flowScreens.map((screen) => screen.screenId),
      confidence: kind === "generic" ? 0.48 : 0.78
    };
  });
}

function buildMotionThesis(
  scan: CodebaseScanResult,
  screens: MotionScreen[],
  concept: ProjectConcept | undefined,
  brief?: string
): MotionThesis {
  const text = `${brief ?? ""} ${concept?.brandConcept ?? ""} ${concept?.brandPersonality.join(" ") ?? ""} ${screens.map((screen) => screen.signals.join(" ")).join(" ")}`.toLowerCase();
  const playful = /game|reward|streak|score|play|fun|naughty|delight/.test(text);
  const enterprise = /dashboard|billing|settings|admin|bank|finance|enterprise/.test(text);
  return {
    personality: concept?.brandPersonality.length
      ? concept.brandPersonality
      : playful
        ? ["alive", "rewarding", "playful"]
        : enterprise
          ? ["precise", "confident", "calm"]
          : ["premium", "clear", "responsive"],
    pacing: playful ? "playful" : enterprise ? "calm" : "snappy",
    emotionalMoments: [
      "first brand impression",
      "primary action feedback",
      "loading confidence",
      "success confirmation",
      "error recovery"
    ],
    restraintRules: [
      "Animate only high-leverage moments by default.",
      "Preserve layout, typography, and existing components.",
      "Prefer short spring feedback over long decorative loops.",
      "Respect reduced-motion settings in generated code."
    ],
    motionGrammar: [
      "idle breathing for brand assets",
      "press compression with spring release",
      "success bloom with part-by-part stagger",
      "error shake with restrained amplitude",
      "progress/reward count-up tied to app state"
    ]
  };
}

function buildMotionMap(
  root: string,
  context: AppMotionContext,
  scan: CodebaseScanResult,
  assets: AssetIndexResult,
  brief?: string
): MotionMapResult {
  const componentsById = new Map(scan.componentFiles.map((component) => [component.id, component]));
  const opportunities = context.screens.flatMap((screen) => {
    const component = componentsById.get(screen.componentIds[0] ?? "");
    return opportunityTemplates(screen, component, context, assets, brief);
  })
    .sort((a, b) => b.valueScore - a.valueScore)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.screenId === item.screenId && candidate.moment === item.moment) === index)
    .slice(0, Math.max(3, context.flows.length * 3));

  return {
    mapId: stableId("motionmap", `${root}:${brief ?? ""}:${nowIso()}`),
    rootPath: root,
    opportunities,
    totalEstimatedCredits: opportunities.reduce((sum, item) => sum + item.credits, 0),
    createdAt: nowIso()
  };
}

function opportunityTemplates(
  screen: MotionScreen,
  component: ComponentFile | undefined,
  context: AppMotionContext,
  assets: AssetIndexResult,
  brief?: string
): ScreenMotionOpportunity[] {
  const text = `${screen.path} ${screen.name} ${screen.signals.join(" ")} ${brief ?? ""}`.toLowerCase();
  const moments = [
    momentForScreen(text),
    text.includes("loading") ? "loading confidence" : "primary action feedback",
    text.includes("success") || text.includes("complete") ? "success confirmation" : "brand memory"
  ];
  return unique(moments).map((moment) => {
    const assetBrief = assetBriefForMoment(moment, screen, context);
    const lane = decideAssetLane(assetBrief, screen, context);
    const viewModel = viewModelForMoment(screen, component, moment);
    const stateMachine = stateMachineForMoment(screen, viewModel, moment);
    return {
      opportunityId: stableId("opportunity", `${screen.screenId}:${moment}`),
      screenId: screen.screenId,
      flowId: screen.flowId,
      componentId: component?.id,
      file: screen.path,
      moment,
      assetNeed: assetBrief,
      stateMachineNeed: stateMachine.bindings.map((binding) => binding.description).join("; "),
      lane: lane.lane,
      credits: lane.estimatedCredits,
      risk: riskFor(component, lane.lane, assets),
      valueScore: scoreMoment(moment, screen, context),
      whyItMatters: whyMomentMatters(moment, screen),
      svgBrief: lane.svgBrief,
      acceptanceChecklist: lane.acceptanceChecklist,
      viewModel,
      stateMachine
    };
  });
}

function decideAssetLane(
  assetBrief: string,
  screen: MotionScreen | undefined,
  context: AppMotionContext
): AssetLaneDecision {
  const text = `${assetBrief} ${screen?.name ?? ""} ${screen?.path ?? ""} ${screen?.signals.join(" ") ?? ""}`.toLowerCase();
  const premiumSignals = /hero|brand|mascot|illustration|technical|diagram|empty state|onboarding|complex|multi[- ]?part|cinematic|reward|game/.test(text);
  const simpleSignals = /icon|badge|loader|spinner|check|error|small|decorative|tab|button/.test(text);
  const lane: AssetLane = premiumSignals && !simpleSignals ? "premium" : premiumSignals && /brand|hero|mascot|illustration|reward/.test(text) ? "premium" : "simple";
  const complexity = lane === "premium" ? "high" : simpleSignals ? "low" : "medium";
  const recommendedModel: SvgModelId | undefined = lane === "premium" && /technical|diagram|dense|detailed|high[- ]?fidelity/.test(text) ? "arrow-1.1-max" : lane === "premium" ? "arrow-1.1" : undefined;
  return {
    lane,
    confidence: lane === "premium" ? 0.82 : 0.74,
    reason: lane === "premium"
      ? "This asset has high brand, flow, or visual complexity leverage, so QuiverAI quality is worth the credits."
      : "This asset is simple enough for the host coding model to generate, then Motion MCP can ingest and animate it.",
    estimatedCredits: lane === "premium" ? recommendedModel === "arrow-1.1-max" ? 100 : 50 : 12,
    recommendedModel,
    complexity,
    svgBrief: svgBrief(assetBrief, screen, lane, context),
    acceptanceChecklist: acceptanceChecklist(lane)
  };
}

function viewModelForMoment(
  screen: MotionScreen,
  component: ComponentFile | undefined,
  moment: string
): MotionViewModel {
  const properties = propertiesForMoment(moment, screen, component);
  return {
    viewModelId: stableId("vm", `${screen.screenId}:${moment}`),
    name: `${pascal(screen.name)}MotionViewModel`,
    properties,
    boundScreenId: screen.screenId,
    boundComponentId: component?.id
  };
}

function stateMachineForMoment(
  screen: MotionScreen,
  viewModel: MotionViewModel,
  moment: string
): MotionStateMachine {
  const bindings = bindingsForMoment(moment, viewModel);
  return {
    stateMachineId: stableId("machine", `${screen.screenId}:${moment}`),
    name: `${pascal(screen.name)}${pascal(moment)}Machine`,
    initialState: "idle",
    states: STANDARD_MOTION_STATES,
    events: STANDARD_MOTION_EVENTS,
    transitions: [
      { from: "idle", to: "hover", event: "pointerEnter" },
      { from: "hover", to: "idle", event: "pointerLeave" },
      { from: "hover", to: "pressed", event: "pressIn" },
      { from: "pressed", to: "active", event: "pressOut" },
      { from: "active", to: "success", event: "success", condition: "hasError !== true" },
      { from: "active", to: "error", event: "error", condition: "hasError === true" },
      { from: "success", to: "idle", event: "reset" },
      { from: "error", to: "idle", event: "reset" }
    ],
    bindings,
    viewModel
  };
}

function propertiesForMoment(
  moment: string,
  screen: MotionScreen,
  component: ComponentFile | undefined
): MotionProperty[] {
  const text = `${moment} ${screen.path} ${screen.signals.join(" ")} ${component?.detectedElements.join(" ") ?? ""}`.toLowerCase();
  const properties: MotionProperty[] = [
    { name: "isSelected", type: "boolean", defaultValue: false, description: "Whether the related UI element is selected or active.", source: "app-state" },
    { name: "hasError", type: "boolean", defaultValue: false, description: "Whether this screen or interaction is in an error state.", source: "app-state" },
    { name: "themeColor", type: "color", description: "Primary brand or theme color for generated motion parts.", source: "design-token" }
  ];
  if (/loading|progress|checkout|upload|download/.test(text)) {
    properties.push({ name: "progress", type: "number", defaultValue: 0, description: "Progress from 0 to 1 driving loading/progress motion.", source: "app-state" });
    properties.push({ name: "isLoading", type: "boolean", defaultValue: false, description: "Whether async work is currently in progress.", source: "app-state" });
  }
  if (/score|streak|reward|game|badge|count/.test(text)) {
    properties.push({ name: "count", type: "number", defaultValue: 0, description: "Counter value used for reward or score animation.", source: "game-state" });
    properties.push({ name: "rewardLevel", type: "enum", defaultValue: "base", description: "Reward intensity tier for celebration motion.", source: "game-state" });
  }
  if (/auth|profile|avatar|user/.test(text)) {
    properties.push({ name: "avatarImage", type: "image", description: "Optional user image that can be bound into the generated visual.", source: "app-state" });
  }
  return properties;
}

function bindingsForMoment(moment: string, viewModel: MotionViewModel): MotionBinding[] {
  return viewModel.properties.slice(0, 5).map((property) => ({
    property: property.name,
    targetPart: property.type === "color" ? "accent-parts" : property.type === "number" ? "progress-parts" : "primary-parts",
    source: property.source,
    description: `${property.name} drives ${moment} visual response.`
  }));
}

function isScreenLike(component: ComponentFile, entryPoints: string[]): boolean {
  const text = `${component.path} ${component.exportedComponents.join(" ")} ${component.localComponents.join(" ")}`.toLowerCase();
  return entryPoints.includes(component.path)
    || /(^|\/)(app|pages|screens|routes|views)\//.test(component.path)
    || /screen|page|route|view/.test(text);
}

function flowKindForText(input: string): FlowKind {
  const text = input.toLowerCase();
  if (/onboard|welcome|intro/.test(text)) return "onboarding";
  if (/login|signup|sign-in|auth|password/.test(text)) return "auth";
  if (/dashboard|home|overview|analytics/.test(text)) return "dashboard";
  if (/create|editor|compose|new/.test(text)) return "creation";
  if (/checkout|billing|pricing|payment|subscribe/.test(text)) return "checkout";
  if (/success|complete|done|confirmation/.test(text)) return "success";
  if (/error|empty|not-found|warning|fail/.test(text)) return "error";
  if (/settings|account|profile|preferences/.test(text)) return "settings";
  if (/game|play|level|hud|score/.test(text)) return "game-loop";
  if (/reward|streak|badge|xp|points/.test(text)) return "reward-loop";
  return "generic";
}

function momentForScreen(text: string): string {
  if (/onboard|welcome|hero|brand/.test(text)) return "first brand impression";
  if (/loading|spinner|skeleton/.test(text)) return "loading confidence";
  if (/success|done|complete|checkout/.test(text)) return "success confirmation";
  if (/error|empty|warning/.test(text)) return "error recovery";
  if (/score|streak|reward|game|badge/.test(text)) return "reward feedback";
  return "primary action feedback";
}

function assetBriefForMoment(moment: string, screen: MotionScreen, context: AppMotionContext): string {
  const personality = context.motionThesis.personality.slice(0, 3).join(", ");
  if (moment === "first brand impression") return `A structured brand SVG for ${screen.name}, ${personality}, with named logo, glow, and accent parts.`;
  if (moment === "loading confidence") return `A compact loading/progress SVG for ${screen.name}, with loopable progress, glow, and checkpoint parts.`;
  if (moment === "success confirmation") return `A success confirmation SVG for ${screen.name}, with check, burst, and follow-through parts.`;
  if (moment === "error recovery") return `A friendly error recovery SVG for ${screen.name}, with warning, repair, and retry affordance parts.`;
  if (moment === "reward feedback") return `A reward SVG for ${screen.name}, with badge, streak, sparkle, and level-up parts.`;
  return `A primary action feedback SVG for ${screen.name}, with press, active, success, and disabled parts.`;
}

function svgBrief(assetBrief: string, screen: MotionScreen | undefined, lane: AssetLane, context: AppMotionContext): string {
  return [
    assetBrief,
    `Placement: ${screen?.name ?? "selected screen"}.`,
    `Style: ${context.motionThesis.personality.join(", ")} with ${context.motionThesis.pacing} pacing.`,
    "Must include a viewBox and semantic ids on animatable paths/groups.",
    lane === "premium" ? "Use layered, production-quality structure suitable for QuiverAI." : "Keep it simple enough for the host coding model to generate quickly."
  ].join(" ");
}

function acceptanceChecklist(lane: AssetLane): string[] {
  return [
    "SVG includes a valid viewBox.",
    "At least three animatable parts have stable id or data-name attributes.",
    "No raster image dependency is embedded in the SVG.",
    "Parts are named by role, such as logo-mark, spark-core, progress-ring, success-check, or error-shake.",
    lane === "premium" ? "Composition has enough detail to justify QuiverAI credits." : "Composition stays compact and readable for model-generated SVG."
  ];
}

function scoreMoment(moment: string, screen: MotionScreen, context: AppMotionContext): number {
  let score = 58;
  if (/brand|success|reward/.test(moment)) score += 18;
  if (/primary|loading|error/.test(moment)) score += 12;
  if (context.motionThesis.emotionalMoments.some((item) => moment.includes(item.split(" ")[0] ?? ""))) score += 8;
  if (/page|screen|home|dashboard|index/.test(`${screen.path} ${screen.name}`.toLowerCase())) score += 6;
  return Math.max(0, Math.min(100, score));
}

function whyMomentMatters(moment: string, screen: MotionScreen): string {
  if (moment.includes("brand")) return `${screen.name} can teach the product personality before the user reads copy.`;
  if (moment.includes("loading")) return `${screen.name} can make waiting feel intentional and trustworthy.`;
  if (moment.includes("success")) return `${screen.name} can turn completion into a confident reward moment.`;
  if (moment.includes("error")) return `${screen.name} can reduce frustration and guide recovery.`;
  if (moment.includes("reward")) return `${screen.name} can make progress feel earned.`;
  return `${screen.name} has direct interaction leverage; motion can clarify affordance and quality.`;
}

function riskFor(component: ComponentFile | undefined, lane: AssetLane, assets: AssetIndexResult): ScreenMotionOpportunity["risk"] {
  if (lane === "premium") return "medium";
  if ((component?.usesRive || component?.usesLottie) && assets.assets.length > 12) return "medium";
  return "low";
}

function screenSignals(component: ComponentFile): string[] {
  const signals = [
    ...component.exportedComponents,
    ...component.localComponents,
    ...component.detectedElements
  ].map((item) => item.toLowerCase());
  if (component.usesSvg) signals.push("svg");
  if (component.usesImage) signals.push("image");
  if (component.usesLottie) signals.push("lottie");
  if (component.usesRive) signals.push("rive");
  if (component.usesIconLibrary) signals.push("icons");
  return unique(signals).slice(0, 20);
}

async function detectDesignTokens(root: string, scan: CodebaseScanResult): Promise<AppMotionContext["designTokens"]> {
  const files = [
    ...scan.componentFiles.map((file) => file.path),
    "app/styles.css",
    "src/styles.css",
    "src/index.css",
    "tailwind.config.js",
    "tailwind.config.ts"
  ];
  const colors = new Set<string>();
  const radiusHints = new Set<string>();
  const spacingHints = new Set<string>();
  for (const rel of files.slice(0, 40)) {
    const source = await fs.readFile(path.join(root, rel), "utf8").catch(() => "");
    for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g)) colors.add(match[0]);
    for (const match of source.matchAll(/border-radius\s*:\s*([^;]+)|radius[:\s]+["']?([^"',\n]+)/g)) radiusHints.add((match[1] ?? match[2] ?? "").trim());
    for (const match of source.matchAll(/(?:gap|padding|margin)\s*:\s*([^;]+)/g)) spacingHints.add(match[1]?.trim() ?? "");
  }
  return {
    colors: Array.from(colors).slice(0, 16),
    radiusHints: Array.from(radiusHints).filter(Boolean).slice(0, 8),
    spacingHints: Array.from(spacingHints).filter(Boolean).slice(0, 8)
  };
}

function routePatternForPath(file: string): string | undefined {
  if (file.startsWith("app/")) {
    const route = file
      .replace(/^app\//, "")
      .replace(/\/page\.(tsx|jsx|ts|js)$/, "")
      .replace(/^page\.(tsx|jsx|ts|js)$/, "")
      .replace(/\/index\.(tsx|jsx|ts|js)$/, "")
      .replace(/\.(tsx|jsx|ts|js)$/, "");
    return route ? `/${route}` : "/";
  }
  if (file.startsWith("pages/")) {
    const route = file
      .replace(/^pages\//, "")
      .replace(/\/index\.(tsx|jsx|ts|js)$/, "")
      .replace(/^index\.(tsx|jsx|ts|js)$/, "")
      .replace(/\.(tsx|jsx|ts|js)$/, "");
    return route ? `/${route}` : "/";
  }
  return undefined;
}

function summarizeAssets(assets: AssetIndexResult): AppMotionContext["assetsSummary"] {
  return {
    total: assets.assets.length,
    svg: assets.assets.filter((asset) => asset.type === "svg").length,
    lottie: assets.assets.filter((asset) => asset.type === "lottie").length,
    rive: assets.assets.filter((asset) => asset.type === "rive").length,
    image: assets.assets.filter((asset) => asset.type === "image").length
  };
}

async function loadOrScan(root: string): Promise<CodebaseScanResult> {
  const cached = await readMotionJson<CodebaseScanResult>(root, "scan.json");
  return cached ?? scanCodebase(root);
}

async function loadOrIndex(root: string): Promise<AssetIndexResult> {
  const cached = await readMotionJson<AssetIndexResult>(root, "assets.json");
  return cached ?? scanAssets(root);
}

async function readMotionJson<T>(root: string, file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, ".motion-mcp", file), "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeMotionJson(root: string, file: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.join(root, ".motion-mcp"), { recursive: true });
  await fs.writeFile(path.join(root, ".motion-mcp", file), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function displayComponentName(component: ComponentFile): string {
  return component.exportedComponents[0] ?? component.localComponents[0] ?? path.basename(component.path, path.extname(component.path));
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pascal(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("") || "Motion";
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
