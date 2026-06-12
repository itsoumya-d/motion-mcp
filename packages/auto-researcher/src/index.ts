import { promises as fs } from "node:fs";
import path from "node:path";
import { researchAppMotion } from "@motion-mcp/app-researcher";
import { scanCodebase } from "@motion-mcp/codebase-scanner";
import {
  type AppMotionContext,
  type AutoResearchMotionResult,
  type CodebaseScanResult,
  type FrameworkKind,
  type MotionMapResult,
  type MotionResearchContextPack,
  type MotionResearchFinding,
  type MotionResearchOpportunity,
  type MotionResearchScore,
  type MotionResearchSource,
  type MotionResearchSourceKind,
  type PageStateMachineExperience,
  type ScreenMotionOpportunity,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";
import { researchStateMachineExperience } from "@motion-mcp/state-machine-researcher";

export interface AutoResearchMotionInput {
  rootPath: string;
  brief?: string;
  focusPlatforms?: FrameworkKind[];
  includeSources?: Array<ResearchSourceInput | MotionResearchSource>;
}

export interface ResearchSourceInput {
  sourceId?: string;
  title: string;
  url: string;
  kind?: MotionResearchSourceKind;
  platforms?: string[];
  topics?: string[];
  summary?: string;
  retrievedAt?: string;
  confidence?: number;
  license?: string;
}

const CORE_TOOL_SEQUENCE = [
  "research_app_motion",
  "research_state_machine_experience",
  "plan_screen_motion",
  "estimate_asset_lane",
  "generate_simple_svg_asset or generate_premium_svg_asset",
  "generate_animation",
  "preview_animation",
  "apply_motion_diff"
];

const DEFAULT_VERIFICATION_COMMANDS = [
  "/opt/homebrew/bin/node --test --import tsx tests/*.test.ts",
  "/opt/homebrew/bin/node node_modules/typescript/bin/tsc -p packages/mcp-server/tsconfig.json --noEmit"
];

const DEFAULT_CONSTRAINTS = [
  "Keep the workflow local and mockable.",
  "Do not require hosted crawlers, production credentials, or paid APIs at runtime.",
  "Do not replace existing assets by default; stage reviewable diffs.",
  "Respect reduced-motion preferences.",
  "Prefer React/Next and Expo/React Native for stable codegen; mark Flutter and Unity beta."
];

export async function autoResearchMotion(input: AutoResearchMotionInput): Promise<AutoResearchMotionResult> {
  const root = path.resolve(input.rootPath);
  const scan = await scanCodebase(root);
  const { context, motionMap } = await researchAppMotion({ rootPath: root, brief: input.brief });
  const stateMachineExperience = await researchStateMachineExperience({ rootPath: root, brief: input.brief });
  const sources = normalizeResearchSources([
    ...seedResearchSources(),
    ...(input.includeSources ?? [])
  ]);
  const findings = buildFindings(sources);
  const pageByScreen = new Map(
    stateMachineExperience.pages
      .filter((page) => page.screenId)
      .map((page) => [page.screenId as string, page])
  );
  const opportunities = rankResearchOpportunities([
    ...opportunitiesFromMotionMap(motionMap, context, scan, pageByScreen, sources),
    ...platformFoundationOpportunities(context, scan, stateMachineExperience.pages, sources)
  ])
    .filter((opportunity) => !input.focusPlatforms?.length || input.focusPlatforms.includes(opportunity.framework ?? "unknown"))
    .slice(0, 12);
  const contextPacks = buildContextPacks(root, opportunities, context, scan);
  const opportunitiesWithPacks = opportunities.map((opportunity) => ({
    ...opportunity,
    contextPackId: contextPacks.find((pack) => pack.opportunityIds.includes(opportunity.opportunityId))?.contextPackId
  }));
  const result: AutoResearchMotionResult = {
    researchId: stableId("autoresearch", `${root}:${input.brief ?? ""}:${nowIso()}`),
    rootPath: root,
    brief: input.brief,
    sources,
    findings,
    opportunities: opportunitiesWithPacks,
    contextPacks,
    summary: {
      totalSources: sources.length,
      totalFindings: findings.length,
      totalOpportunities: opportunitiesWithPacks.length,
      topOpportunityId: opportunitiesWithPacks[0]?.opportunityId,
      stableTargets: unique(context.frameworks.filter((framework) => stableFrameworks.has(framework))),
      betaTargets: unique(context.frameworks.filter((framework) => betaFrameworks.has(framework)))
    },
    createdAt: nowIso()
  };
  await writeMotionJson(root, "auto-research.json", result);
  return result;
}

export function normalizeResearchSource(input: ResearchSourceInput | MotionResearchSource): MotionResearchSource {
  const title = input.title.trim();
  const url = input.url.trim();
  return {
    sourceId: input.sourceId ?? stableId("source", `${title}:${url}`),
    title,
    url,
    kind: input.kind ?? "article",
    platforms: unique((input.platforms ?? ["cross-platform"]).map(normalizeTag)),
    topics: unique((input.topics ?? ["motion"]).map(normalizeTag)),
    summary: input.summary?.trim() || title,
    retrievedAt: input.retrievedAt ?? nowIso(),
    confidence: clamp(input.confidence ?? 0.76),
    license: input.license
  };
}

export function normalizeResearchSources(inputs: Array<ResearchSourceInput | MotionResearchSource>): MotionResearchSource[] {
  const byId = new Map<string, MotionResearchSource>();
  for (const input of inputs) {
    const source = normalizeResearchSource(input);
    byId.set(source.sourceId, source);
  }
  return Array.from(byId.values()).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export function rankResearchOpportunities(opportunities: MotionResearchOpportunity[]): MotionResearchOpportunity[] {
  return opportunities
    .map((opportunity) => ({
      ...opportunity,
      score: {
        ...opportunity.score,
        total: totalScore(opportunity.score)
      }
    }))
    .sort((a, b) => b.score.total - a.score.total || a.title.localeCompare(b.title));
}

function seedResearchSources(): MotionResearchSource[] {
  return normalizeResearchSources([
    {
      sourceId: "rive-state-machine",
      title: "Rive State Machine Overview",
      url: "https://rive.app/docs/editor/state-machine/state-machine",
      kind: "official-doc",
      platforms: ["cross-platform", "game", "web", "mobile"],
      topics: ["state-machine", "layers", "transitions"],
      summary: "Rive state machines model animation logic with graphs, states, transitions, and layers for product, app, game, and website implementation.",
      confidence: 0.96
    },
    {
      sourceId: "rive-states",
      title: "Rive States",
      url: "https://rive.app/docs/editor/state-machine/states",
      kind: "official-doc",
      platforms: ["cross-platform"],
      topics: ["entry-state", "exit-state", "any-state", "blend-state"],
      summary: "Rive states include entry, exit, any, single animation, 1D blend, and additive/direct blend concepts.",
      confidence: 0.95
    },
    {
      sourceId: "rive-transitions",
      title: "Rive Transitions",
      url: "https://rive.app/docs/editor/state-machine/transitions",
      kind: "official-doc",
      platforms: ["cross-platform"],
      topics: ["conditions", "actions", "timing", "interpolation"],
      summary: "Rive transitions carry conditions, duration, exit-time, pause-on-exit, interpolation, and actions.",
      confidence: 0.95
    },
    {
      sourceId: "rive-view-models",
      title: "Rive View Models & Instances",
      url: "https://rive.app/docs/editor/data-binding/view-models",
      kind: "official-doc",
      platforms: ["cross-platform"],
      topics: ["data-binding", "view-model", "runtime-state"],
      summary: "View Models define reusable typed data structures whose instances can bind values to text, images, colors, animations, and state machines.",
      confidence: 0.95
    },
    {
      sourceId: "rive-runtime",
      title: "Rive Runtime",
      url: "https://github.com/rive-app/rive-runtime",
      kind: "repo",
      platforms: ["cross-platform", "unity", "flutter", "web"],
      topics: ["runtime", "renderer", "state-machine"],
      summary: "Rive's low-level runtime loads .riv files, advances state machines, mutates artboards, and renders through GPU backends.",
      confidence: 0.91,
      license: "MIT"
    },
    {
      sourceId: "lottie-web",
      title: "Lottie Web",
      url: "https://github.com/airbnb/lottie-web",
      kind: "repo",
      platforms: ["web", "ios", "android", "react-native"],
      topics: ["lottie", "vector-playback", "after-effects"],
      summary: "Lottie parses Bodymovin-exported After Effects JSON and renders animations across web and mobile runtimes.",
      confidence: 0.9,
      license: "MIT"
    },
    {
      sourceId: "motion-react",
      title: "Motion for React Animation",
      url: "https://motion.dev/docs/react-animation",
      kind: "official-doc",
      platforms: ["react", "next", "web"],
      topics: ["variants", "gestures", "svg", "layout"],
      summary: "Motion for React supports motion components, variants, gestures, SVG elements, layout, scroll, and transition controls.",
      confidence: 0.91
    },
    {
      sourceId: "motion-use-animate",
      title: "Motion useAnimate",
      url: "https://motion.dev/docs/react-use-animate",
      kind: "official-doc",
      platforms: ["react", "next", "web"],
      topics: ["timeline", "manual-controls", "scoped-selectors"],
      summary: "useAnimate provides scoped manual animation controls, local selector scoping, timelines, and cleanup.",
      confidence: 0.89
    },
    {
      sourceId: "gsap-timeline",
      title: "GSAP Timeline",
      url: "https://gsap.com/docs/v3/GSAP/Timeline/",
      kind: "official-doc",
      platforms: ["web", "react", "next"],
      topics: ["timeline", "sequencing", "callbacks"],
      summary: "GSAP timelines sequence tweens and callbacks with whole-timeline playback control.",
      confidence: 0.89
    },
    {
      sourceId: "reanimated-shared-values",
      title: "React Native Reanimated Shared Values",
      url: "https://docs.swmansion.com/react-native-reanimated/docs/2.x/fundamentals/shared-values/",
      kind: "official-doc",
      platforms: ["expo", "react-native"],
      topics: ["shared-values", "ui-thread", "reactive-animation"],
      summary: "Shared values carry mutable animatable data across JS/UI threads and drive reactive animations.",
      confidence: 0.9
    },
    {
      sourceId: "reanimated-animated-props",
      title: "React Native Reanimated useAnimatedProps",
      url: "https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedProps/",
      kind: "official-doc",
      platforms: ["expo", "react-native"],
      topics: ["animated-props", "svg", "third-party-components"],
      summary: "useAnimatedProps creates animated props for third-party components, including SVG nodes.",
      confidence: 0.9
    },
    {
      sourceId: "react-native-svg",
      title: "react-native-svg",
      url: "https://github.com/software-mansion/react-native-svg",
      kind: "repo",
      platforms: ["expo", "react-native"],
      topics: ["svg", "mobile", "fabric"],
      summary: "react-native-svg provides SVG support across React Native platforms and supports most SVG elements and properties.",
      confidence: 0.9,
      license: "MIT"
    },
    {
      sourceId: "flutter-animations",
      title: "Flutter Animations",
      url: "https://docs.flutter.dev/ui/animations",
      kind: "official-doc",
      platforms: ["flutter"],
      topics: ["animation-controller", "animated-builder", "custom-painter"],
      summary: "Flutter animation fundamentals include AnimationController, Tween, CurvedAnimation, listeners, status listeners, and vsync.",
      confidence: 0.9
    },
    {
      sourceId: "unity-animator-state-machine",
      title: "Unity Animation State Machines",
      url: "https://docs.unity3d.com/Manual/AnimationStateMachines.html",
      kind: "official-doc",
      platforms: ["unity", "game"],
      topics: ["state-machine", "animator", "parameters"],
      summary: "Unity Animator controllers use state machines with states, transitions, and parameters controlled from scripts.",
      confidence: 0.9
    },
    {
      sourceId: "unity-ui-toolkit-transitions",
      title: "Unity UI Toolkit USS Transitions",
      url: "https://docs.unity3d.com/6000.3/Documentation/Manual/UIE-Transitions.html",
      kind: "official-doc",
      platforms: ["unity", "game"],
      topics: ["ui-toolkit", "transitions", "pointer-feedback"],
      summary: "UI Toolkit transitions animate property changes via duration, timing, delay, pseudo-classes, C# methods, or events.",
      confidence: 0.89
    },
    {
      sourceId: "dotween-sequences",
      title: "DOTween Sequences",
      url: "https://dotween.demigiant.com/documentation.php",
      kind: "official-doc",
      platforms: ["unity", "game"],
      topics: ["sequence", "callbacks", "tweening"],
      summary: "DOTween sequences support append, join, insert, intervals, callbacks, and chained C# animation timing.",
      confidence: 0.87
    },
    {
      sourceId: "material-motion",
      title: "Material Design Motion",
      url: "https://m2.material.io/design/motion/understanding-motion.html",
      kind: "platform-guideline",
      platforms: ["web", "mobile", "cross-platform"],
      topics: ["feedback", "status", "motion-guidelines"],
      summary: "Material frames motion as timely feedback that communicates status and user/system action.",
      confidence: 0.86
    },
    {
      sourceId: "apple-motion-accessibility",
      title: "Apple Human Interface Guidelines Motion and Accessibility",
      url: "https://developer.apple.com/design/human-interface-guidelines/motion",
      kind: "platform-guideline",
      platforms: ["ios", "macos", "mobile"],
      topics: ["motion", "reduced-motion", "accessibility"],
      summary: "Apple frames motion as status, feedback, instruction, and richness while requiring reduced-motion sensitivity.",
      confidence: 0.84
    },
    {
      sourceId: "karpathy-context-engineering",
      title: "Andrej Karpathy Context Engineering",
      url: "https://x.com/karpathy/status/1937902205765607626",
      kind: "article",
      platforms: ["agent"],
      topics: ["context-engineering", "agent-workflow"],
      summary: "Context engineering is about giving the model the right information for the next step instead of relying on one giant prompt.",
      confidence: 0.82
    },
    {
      sourceId: "langchain-context-engineering",
      title: "LangChain Context Engineering for Agents",
      url: "https://www.langchain.com/blog/context-engineering-for-agents",
      kind: "article",
      platforms: ["agent"],
      topics: ["write", "select", "compress", "isolate", "agent-context"],
      summary: "Agent context engineering strategies include writing, selecting, compressing, and isolating context at each step.",
      confidence: 0.86
    },
    {
      sourceId: "quiverai-quickstart",
      title: "QuiverAI API Quickstart",
      url: "https://docs.quiver.ai/getting-started/quickstart",
      kind: "api-doc",
      platforms: ["svg", "agent"],
      topics: ["svg-generation", "pricing-credits", "rate-limits"],
      summary: "QuiverAI exposes model selection, pricing credits, generation/vectorization, error codes, and rate-limit metadata.",
      confidence: 0.9
    }
  ]);
}

function buildFindings(sources: MotionResearchSource[]): MotionResearchFinding[] {
  const finding = (
    category: string,
    title: string,
    summary: string,
    sourceIds: string[],
    platforms: string[],
    implications: string[],
    confidence = 0.84
  ): MotionResearchFinding => ({
    findingId: stableId("finding", `${category}:${title}`),
    category,
    title,
    summary,
    sourceIds: sourceIds.filter((id) => sources.some((source) => source.sourceId === id)),
    platforms,
    implications,
    confidence
  });

  return [
    finding(
      "Rive-like state contracts",
      "State machines are the interaction moat",
      "Rive's strength is not just vector playback; it is named states, transition conditions, layers, actions, and data binding.",
      ["rive-state-machine", "rive-states", "rive-transitions", "rive-view-models", "rive-runtime"],
      ["cross-platform", "web", "mobile", "game"],
      [
        "Generate state-machine specs before code.",
        "Bind motion to app state through ViewModel-style properties.",
        "Keep generated state contracts visible in host code."
      ],
      0.93
    ),
    finding(
      "Vector playback",
      "Lottie proves broad runtimes matter, but clips are not enough",
      "Lottie succeeds through wide playback support for exported vector animation, but it does not decide where motion belongs in a codebase.",
      ["lottie-web"],
      ["web", "mobile"],
      [
        "Support Lottie-like lightweight SVG assets in the simple lane.",
        "Differentiate by generating local state-aware code, not only playback."
      ]
    ),
    finding(
      "Framework-native emitters",
      "Best output should use the host framework's motion primitives",
      "React, React Native, Flutter, and Unity all have strong native animation idioms; Motion MCP should emit into those idioms instead of inventing a runtime.",
      ["motion-react", "motion-use-animate", "gsap-timeline", "reanimated-shared-values", "reanimated-animated-props", "react-native-svg", "flutter-animations", "unity-animator-state-machine", "unity-ui-toolkit-transitions", "dotween-sequences"],
      ["next", "react", "expo", "react-native", "flutter", "unity"],
      [
        "React/Next can use Motion variants and scoped timelines.",
        "Expo/RN can bind shared values into SVG animated props.",
        "Flutter/Unity should remain beta until generated contracts and demos are validated."
      ],
      0.9
    ),
    finding(
      "Restraint and accessibility",
      "Premium motion is selective, accessible feedback",
      "Product motion guidance emphasizes feedback, status, instruction, and reduced-motion handling rather than constant decoration.",
      ["material-motion", "apple-motion-accessibility"],
      ["web", "mobile", "cross-platform"],
      [
        "Rank top moments instead of animating everything.",
        "Include reduced-motion constraints in every context pack.",
        "Prioritize confidence, affordance clarity, reward, and conversion."
      ],
      0.86
    ),
    finding(
      "Agent context engineering",
      "The product should curate context per step",
      "Karpathy-style context engineering and LangChain's write/select/compress/isolate framing support a tool that gives agents the right local files, sources, constraints, and verification for the next step.",
      ["karpathy-context-engineering", "langchain-context-engineering"],
      ["agent"],
      [
        "Emit source-backed context packs, not giant prompts.",
        "Reference source IDs and local evidence in every opportunity.",
        "Make verification commands part of the generated context."
      ],
      0.84
    ),
    finding(
      "Premium SVG lane",
      "Quiver belongs behind a cost-aware lane decision",
      "QuiverAI is a premium structured SVG provider with live pricing credits, model selection, and rate-limit/error metadata.",
      ["quiverai-quickstart"],
      ["svg", "agent"],
      [
        "Use the host model for simple SVGs and Quiver for brand-critical/high-fidelity assets.",
        "Keep credit estimates visible before generation.",
        "Store prompt/model/cost metadata for future motion grammar training."
      ],
      0.88
    )
  ];
}

function opportunitiesFromMotionMap(
  motionMap: MotionMapResult,
  context: AppMotionContext,
  scan: CodebaseScanResult,
  pageByScreen: Map<string, PageStateMachineExperience>,
  sources: MotionResearchSource[]
): MotionResearchOpportunity[] {
  return motionMap.opportunities.slice(0, 9).map((motionOpportunity) => {
    const screen = context.screens.find((candidate) => candidate.screenId === motionOpportunity.screenId);
    const page = pageByScreen.get(motionOpportunity.screenId);
    const framework = screen?.framework === "unknown" ? scan.framework : screen?.framework ?? scan.framework;
    const sourceIds = sourceIdsForOpportunity(framework, motionOpportunity, page);
    const score = scoreOpportunity(motionOpportunity, framework, page, sourceIds, sources);
    const title = `${titleCase(motionOpportunity.moment)} on ${screen?.name ?? motionOpportunity.file}`;
    return {
      opportunityId: stableId("research_opp", `${motionOpportunity.opportunityId}:auto`),
      title,
      summary: `${motionOpportunity.whyItMatters} Recommended asset lane: ${motionOpportunity.lane}. ${motionOpportunity.stateMachineNeed}`,
      category: categoryForFramework(framework),
      targetPlatform: platformLabel(framework),
      framework,
      file: motionOpportunity.file,
      screenId: motionOpportunity.screenId,
      flowId: motionOpportunity.flowId,
      moment: motionOpportunity.moment,
      sourceIds,
      localEvidence: [
        `research_app_motion ranked this moment at ${motionOpportunity.valueScore}/100.`,
        `Detected file: ${motionOpportunity.file}.`,
        `Asset need: ${motionOpportunity.assetNeed}.`,
        `State-machine need: ${motionOpportunity.stateMachineNeed || "standard interaction states"}.`,
        page ? `state_machine_experience page codegen target: ${page.codegen.target}, ready: ${page.codegen.readyForCodegen}.` : "No page state-machine spec matched this screen yet."
      ],
      score,
      recommendedToolSequence: CORE_TOOL_SEQUENCE,
      verificationCommands: verificationForFramework(framework),
      constraints: constraintsForFramework(framework, motionOpportunity.risk)
    };
  });
}

function platformFoundationOpportunities(
  context: AppMotionContext,
  scan: CodebaseScanResult,
  pages: PageStateMachineExperience[],
  sources: MotionResearchSource[]
): MotionResearchOpportunity[] {
  const frameworks = unique(context.frameworks.length ? context.frameworks : [scan.framework]);
  return frameworks.map((framework) => {
    const relatedPages = pages.filter((page) => page.framework === framework);
    const sourceIds = sourceIdsForOpportunity(framework);
    const stable = stableFrameworks.has(framework);
    const impact = stable ? 78 : 66;
    const score: MotionResearchScore = {
      impact,
      sourceSupport: sourceSupportScore(sourceIds, sources),
      localFit: relatedPages.length ? 84 : 68,
      effort: stable ? 82 : 54,
      verificationStrength: stable ? 84 : 58,
      safety: stable ? 86 : 72,
      total: 0
    };
    return {
      opportunityId: stableId("research_opp", `foundation:${framework}:${context.contextId}`),
      title: `${platformLabel(framework)} source-backed motion foundation`,
      summary: stable
        ? `Create a source-backed context pack for ${platformLabel(framework)} using the existing app motion and state-machine research outputs.`
        : `Keep ${platformLabel(framework)} beta-labeled while producing inspectable state-machine contracts and verification notes.`,
      category: "platform-foundation",
      targetPlatform: platformLabel(framework),
      framework,
      file: relatedPages[0]?.file ?? scan.entryPoints[0],
      sourceIds,
      localEvidence: [
        `Detected framework: ${framework}.`,
        `Detected ${relatedPages.length} page-like state-machine surfaces for this framework.`,
        `Detected animation libraries: ${scan.animationLibsPresent.join(", ") || "none"}.`
      ],
      score: { ...score, total: totalScore(score) },
      recommendedToolSequence: ["auto_research_motion", ...CORE_TOOL_SEQUENCE],
      verificationCommands: verificationForFramework(framework),
      constraints: constraintsForFramework(framework, stable ? "low" : "medium")
    };
  });
}

function buildContextPacks(
  root: string,
  opportunities: MotionResearchOpportunity[],
  context: AppMotionContext,
  scan: CodebaseScanResult
): MotionResearchContextPack[] {
  return opportunities.slice(0, Math.min(3, opportunities.length)).map((opportunity, index) => {
    const selectedFiles = unique([
      opportunity.file,
      context.screens.find((screen) => screen.screenId === opportunity.screenId)?.path,
      ...scan.entryPoints.slice(0, 2)
    ].filter((file): file is string => Boolean(file)))
      .slice(0, 5)
      .map((file) => ({
        path: file,
        reason: file === opportunity.file ? "Primary local surface for this motion opportunity." : "Supporting app context for the generated diff."
      }));
    return {
      contextPackId: stableId("ctxpack", `${opportunity.opportunityId}:${index}`),
      purpose: `Help the host coding agent implement: ${opportunity.title}`,
      rootPath: root,
      targetFrameworks: unique([opportunity.framework ?? scan.framework].filter((framework) => framework !== "unknown")),
      selectedFiles,
      sourceIds: opportunity.sourceIds,
      localEvidence: opportunity.localEvidence,
      constraints: unique([...DEFAULT_CONSTRAINTS, ...opportunity.constraints]),
      recommendedToolSequence: opportunity.recommendedToolSequence,
      verificationCommands: opportunity.verificationCommands,
      opportunityIds: [opportunity.opportunityId]
    };
  });
}

function sourceIdsForOpportunity(
  framework: FrameworkKind,
  opportunity?: ScreenMotionOpportunity,
  page?: PageStateMachineExperience
): string[] {
  const ids = new Set(["rive-state-machine", "rive-transitions", "rive-view-models", "material-motion", "langchain-context-engineering"]);
  if (opportunity?.lane === "premium") ids.add("quiverai-quickstart");
  if (framework === "next" || framework === "react" || framework === "unknown") {
    ids.add("motion-react");
    ids.add("motion-use-animate");
    if (page?.codegen.supportedFeatures.includes("actions") || page?.layers.length && page.layers.length > 2) ids.add("gsap-timeline");
  }
  if (framework === "expo" || framework === "react-native") {
    ids.add("reanimated-shared-values");
    ids.add("reanimated-animated-props");
    ids.add("react-native-svg");
  }
  if (framework === "flutter") ids.add("flutter-animations");
  if (framework === "unity") {
    ids.add("unity-animator-state-machine");
    ids.add("unity-ui-toolkit-transitions");
    ids.add("dotween-sequences");
  }
  if (opportunity?.assetNeed.toLowerCase().includes("lottie")) ids.add("lottie-web");
  return Array.from(ids);
}

function scoreOpportunity(
  opportunity: ScreenMotionOpportunity,
  framework: FrameworkKind,
  page: PageStateMachineExperience | undefined,
  sourceIds: string[],
  sources: MotionResearchSource[]
): MotionResearchScore {
  const stable = stableFrameworks.has(framework);
  const riskPenalty = opportunity.risk === "high" ? 24 : opportunity.risk === "medium" ? 10 : 0;
  const score: MotionResearchScore = {
    impact: clamp(opportunity.valueScore),
    sourceSupport: sourceSupportScore(sourceIds, sources),
    localFit: clamp((page ? 76 : 62) + (page?.codegen.readyForCodegen ? 16 : 0) + (opportunity.componentId ? 6 : 0)),
    effort: clamp((stable ? 82 : 56) - riskPenalty + (opportunity.lane === "simple" ? 8 : -4)),
    verificationStrength: clamp(stable ? 84 : 58),
    safety: clamp(92 - riskPenalty),
    total: 0
  };
  return { ...score, total: totalScore(score) };
}

function sourceSupportScore(sourceIds: string[], sources: MotionResearchSource[]): number {
  const selected = sourceIds
    .map((id) => sources.find((source) => source.sourceId === id))
    .filter((source): source is MotionResearchSource => Boolean(source));
  const official = selected.filter((source) => source.kind === "official-doc" || source.kind === "repo" || source.kind === "api-doc" || source.kind === "platform-guideline").length;
  return clamp(48 + selected.length * 4 + official * 4);
}

function totalScore(score: MotionResearchScore): number {
  return Math.round(
    score.impact * 0.3
    + score.sourceSupport * 0.2
    + score.localFit * 0.2
    + score.effort * 0.15
    + score.verificationStrength * 0.1
    + score.safety * 0.05
  );
}

function categoryForFramework(framework: FrameworkKind): string {
  if (framework === "expo" || framework === "react-native") return "mobile-motion";
  if (framework === "flutter") return "flutter-beta";
  if (framework === "unity") return "game-ui-beta";
  return "web-motion";
}

function platformLabel(framework: FrameworkKind): string {
  if (framework === "next") return "Next.js";
  if (framework === "react") return "React";
  if (framework === "react-native") return "React Native";
  if (framework === "expo") return "Expo";
  if (framework === "flutter") return "Flutter beta";
  if (framework === "unity") return "Unity beta";
  return "Cross-platform";
}

function verificationForFramework(framework: FrameworkKind): string[] {
  if (framework === "next" || framework === "react" || framework === "unknown") {
    return [
      "/opt/homebrew/bin/node --test --import tsx tests/*.test.ts",
      "/opt/homebrew/bin/node node_modules/typescript/bin/tsc -p packages/emitter-react/tsconfig.json --noEmit"
    ];
  }
  if (framework === "expo" || framework === "react-native") {
    return [
      "/opt/homebrew/bin/node --test --import tsx tests/*.test.ts",
      "/opt/homebrew/bin/node node_modules/typescript/bin/tsc -p packages/emitter-react-native/tsconfig.json --noEmit"
    ];
  }
  if (framework === "flutter") {
    return [
      "/opt/homebrew/bin/node node_modules/typescript/bin/tsc -p packages/emitter-flutter/tsconfig.json --noEmit"
    ];
  }
  if (framework === "unity") {
    return [
      "/opt/homebrew/bin/node node_modules/typescript/bin/tsc -p packages/emitter-unity/tsconfig.json --noEmit"
    ];
  }
  return DEFAULT_VERIFICATION_COMMANDS;
}

function constraintsForFramework(framework: FrameworkKind, risk: ScreenMotionOpportunity["risk"]): string[] {
  const output = [...DEFAULT_CONSTRAINTS];
  if (risk !== "low") output.push(`Treat this as ${risk}-risk and preview before applying.`);
  if (framework === "flutter" || framework === "unity") output.push("Keep this beta-labeled; generate contracts before production code.");
  if (framework === "expo" || framework === "react-native") output.push("Use real SVG path data with Reanimated shared values and animated props.");
  if (framework === "next" || framework === "react") output.push("Prefer Motion variants for simple states and scoped timelines only when choreography needs them.");
  return unique(output);
}

async function writeMotionJson(root: string, file: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.join(root, ".motion-mcp"), { recursive: true });
  await fs.writeFile(path.join(root, ".motion-mcp", file), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/--+/g, "-").replace(/^-+|-+$/g, "") || "motion";
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

const stableFrameworks = new Set<FrameworkKind>(["next", "react", "expo", "react-native"]);
const betaFrameworks = new Set<FrameworkKind>(["flutter", "unity"]);
