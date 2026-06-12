import { promises as fs } from "node:fs";
import path from "node:path";
import { researchAppMotion } from "@motion-mcp/app-researcher";
import { scanCodebase } from "@motion-mcp/codebase-scanner";
import {
  type AppMotionContext,
  type CodebaseScanResult,
  type ComponentFile,
  type FrameworkKind,
  type MotionAction,
  type MotionBinding,
  type MotionCondition,
  type MotionLayer,
  type MotionListener,
  type MotionProperty,
  type MotionStateKind,
  type MotionStateNode,
  type MotionTransitionTiming,
  type MotionViewModel,
  type PageStateMachineExperience,
  type RiveLikeTransition,
  type StateMachineCodegenReadiness,
  type StateMachineExperienceResult,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";

export interface ResearchStateMachineExperienceInput {
  rootPath: string;
  brief?: string;
}

type PageKind =
  | "motion-mcp-product"
  | "route-shell"
  | "pulseforge-landing"
  | "daily-streak"
  | "payment"
  | "unity-menu"
  | "generic";

interface PageSurface {
  surfaceId: string;
  screenId?: string;
  file: string;
  routePattern?: string;
  framework: FrameworkKind;
  name: string;
  signals: string[];
  source: string;
  kind: PageKind;
}

interface LayerTemplate {
  name: string;
  description: string;
  ownedParts: string[];
  states: Array<{
    name: string;
    kind: MotionStateKind;
    description: string;
    parts?: string[];
    blendProperty?: string;
    blendRange?: { min: number; max: number };
    additiveProperties?: string[];
  }>;
}

const RESEARCH_SOURCES = [
  "Rive State Machine Overview: graph, states, transitions, layers",
  "Rive States: entry, exit, any, single, 1D blend, additive blend, actions",
  "Rive Transitions: conditions, duration, exit time, interpolation, actions",
  "Rive Layers: ordered layers with right-most priority",
  "Rive Data Binding: ViewModels, instances, runtime data bindings"
];

export async function researchStateMachineExperience(
  input: ResearchStateMachineExperienceInput
): Promise<StateMachineExperienceResult> {
  const root = path.resolve(input.rootPath);
  const { context } = await researchAppMotion({ rootPath: root, brief: input.brief });
  const scan = await loadOrScan(root);
  const surfaces = await buildPageSurfaces(root, scan, context);
  const pages = surfaces.map((surface) => buildPageExperience(surface, context, input.brief));
  const result: StateMachineExperienceResult = {
    experienceId: stableId("smexp", `${root}:${input.brief ?? ""}:${nowIso()}`),
    rootPath: root,
    pages,
    summary: {
      totalPages: pages.length,
      stableCodegenPages: pages.filter((page) => page.codegen.readyForCodegen).length,
      betaSpecPages: pages.filter((page) => page.codegen.target === "flutter" || page.codegen.target === "unity").length,
      specOnlyPages: pages.filter((page) => !page.codegen.readyForCodegen).length
    },
    researchSources: RESEARCH_SOURCES,
    createdAt: nowIso()
  };
  await writeMotionJson(root, "state-machine-experience.json", result);
  return result;
}

async function buildPageSurfaces(
  root: string,
  scan: CodebaseScanResult,
  context: AppMotionContext
): Promise<PageSurface[]> {
  const screensByPath = new Map(context.screens.map((screen) => [screen.path, screen]));
  const components = scan.componentFiles.filter(isExperienceSurface);
  const fromComponents = await Promise.all(components.map(async (component) => {
    const source = await fs.readFile(path.join(root, component.path), "utf8").catch(() => "");
    const framework = await inferSurfaceFramework(root, component);
    const screen = screensByPath.get(component.path);
    const surface: PageSurface = {
      surfaceId: stableId("surface", component.path),
      screenId: screen?.screenId ?? stableId("screen", component.path),
      file: component.path,
      routePattern: screen?.routePattern ?? routePatternForPath(component.path),
      framework,
      name: displayName(component),
      signals: unique([
        ...component.exportedComponents,
        ...component.localComponents,
        ...component.detectedElements,
        ...(screen?.signals ?? [])
      ]).slice(0, 30),
      source,
      kind: classifySurface(component.path, source)
    };
    return surface;
  }));

  const existing = new Set(fromComponents.map((surface) => surface.file));
  const fromContext = context.screens
    .filter((screen) => !existing.has(screen.path))
    .map((screen): PageSurface => ({
      surfaceId: stableId("surface", screen.path),
      screenId: screen.screenId,
      file: screen.path,
      routePattern: screen.routePattern,
      framework: screen.framework,
      name: screen.name,
      signals: screen.signals,
      source: "",
      kind: classifySurface(screen.path, screen.signals.join(" "))
    }));

  return [...fromComponents, ...fromContext]
    .sort((a, b) => a.file.localeCompare(b.file));
}

function buildPageExperience(
  surface: PageSurface,
  context: AppMotionContext,
  brief?: string
): PageStateMachineExperience {
  const pageId = stableId("pageexp", surface.file);
  const viewModel = viewModelForSurface(pageId, surface, context);
  const layerTemplates = layerTemplatesForSurface(surface, brief);
  const layers = layerTemplates.map((template, order) => materializeLayer(pageId, template, order));
  const transitions = layers.flatMap((layer) => transitionsForLayer(pageId, layer, viewModel));
  const listeners = listenersForSurface(pageId, surface, layers);
  const bindings = bindingsForSurface(surface, viewModel);
  const codegen = codegenReadiness(surface, layers, transitions);
  return {
    pageId,
    screenId: surface.screenId,
    file: surface.file,
    routePattern: surface.routePattern,
    framework: surface.framework,
    name: surface.name,
    experienceSummary: experienceSummary(surface),
    restraintRules: restraintRulesForSurface(surface, context),
    assetNeeds: assetNeedsForSurface(surface),
    viewModel,
    layers,
    transitions,
    listeners,
    bindings,
    codegen
  };
}

function isExperienceSurface(component: ComponentFile): boolean {
  const file = component.path;
  if (/(^|\/)app\/.*(page|layout|index)\.(tsx|jsx|ts|js)$/.test(file)) return true;
  if (/(^|\/)pages\/.*\.(tsx|jsx|ts|js)$/.test(file)) return true;
  if (/(^|\/)(screens|routes|views)\/.*\.(tsx|jsx|ts|js|dart|cs)$/.test(file)) return true;
  if (/(^|\/)App\.(tsx|jsx|ts|js)$/.test(file)) return true;
  if (file.endsWith("lib/main.dart")) return true;
  if (file.endsWith(".dart") && /(screen|page|view|main)/i.test(file)) return true;
  if (file.endsWith(".cs") && /(MenuButton|HUD|Hud|Controller|Screen|View|Manager)/.test(file)) return true;
  return false;
}

async function inferSurfaceFramework(root: string, component: ComponentFile): Promise<FrameworkKind> {
  const ext = path.extname(component.path);
  if (ext === ".dart") return "flutter";
  if (ext === ".cs" || ext === ".uxml") return "unity";
  const deps = await nearestPackageDependencies(root, component.path);
  if (deps.expo) return "expo";
  if (deps["react-native"]) return "react-native";
  if (deps.next) return "next";
  if (deps.react) return "react";
  return component.framework;
}

async function nearestPackageDependencies(root: string, relativeFile: string): Promise<Record<string, string>> {
  let dir = path.dirname(path.join(root, relativeFile));
  while (dir.startsWith(root)) {
    const packagePath = path.join(dir, "package.json");
    const raw = await fs.readFile(packagePath, "utf8").catch(() => "");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
        };
        return {
          ...parsed.dependencies,
          ...parsed.devDependencies,
          ...parsed.peerDependencies
        };
      } catch {
        return {};
      }
    }
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return {};
}

function classifySurface(file: string, source: string): PageKind {
  const text = `${file} ${source}`.toLowerCase();
  if (/layout\.(tsx|jsx|ts|js)$/.test(file)) return "route-shell";
  if (text.includes("motion mcp") || text.includes("credit model")) return "motion-mcp-product";
  if (text.includes("pulseforge") || text.includes("fitness coaching")) return "pulseforge-landing";
  if (text.includes("daily streak") || text.includes("heart")) return "daily-streak";
  if (text.includes("send payment") || text.includes("payment")) return "payment";
  if (file.endsWith(".cs") && /menubutton|play pressed|menu/.test(text)) return "unity-menu";
  return "generic";
}

function viewModelForSurface(
  pageId: string,
  surface: PageSurface,
  context: AppMotionContext
): MotionViewModel {
  const base: MotionProperty[] = [
    { name: "routeStatus", type: "enum", defaultValue: "entering", description: "Route lifecycle state for entering, active, and exiting page motion.", source: "route-state" },
    { name: "isVisible", type: "boolean", defaultValue: true, description: "Whether the page or target region is visible enough to run motion.", source: "app-state" },
    { name: "reducedMotion", type: "boolean", defaultValue: false, description: "User accessibility preference that disables nonessential motion.", source: "app-state" },
    { name: "themeColor", type: "color", description: "Primary design token color for accents and highlights.", source: "design-token" },
    { name: "hasError", type: "boolean", defaultValue: false, description: "Error state that routes feedback layers into recovery motion.", source: "app-state" }
  ];
  const properties = uniqueByName([
    ...base,
    ...propertiesForKind(surface.kind)
  ]);
  return {
    viewModelId: stableId("vm", pageId),
    name: `${pascal(surface.name)}StateMachineViewModel`,
    properties,
    boundScreenId: surface.screenId
  };
}

function propertiesForKind(kind: PageKind): MotionProperty[] {
  if (kind === "motion-mcp-product") {
    return [
      { name: "currentPipelineStep", type: "enum", defaultValue: "scan", description: "Current pipeline stage: scan, map, svgLane, animation, or applied.", source: "app-state" },
      { name: "selectedTool", type: "string", description: "Selected MCP tool card.", source: "app-state" },
      { name: "creditState", type: "enum", defaultValue: "balance", description: "Billing state: balance, reserving, committed, refunded, or error.", source: "app-state" },
      { name: "isReservingCredits", type: "boolean", defaultValue: false, description: "Whether a premium generation call is reserving credits.", source: "app-state" }
    ];
  }
  if (kind === "pulseforge-landing") {
    return [
      { name: "isLogoHovered", type: "boolean", defaultValue: false, description: "Whether the brand mark is hovered or focused.", source: "app-state" },
      { name: "ctaStatus", type: "enum", defaultValue: "idle", description: "CTA state: idle, hover, pressed, loading, success, error, or disabled.", source: "app-state" },
      { name: "isLoading", type: "boolean", defaultValue: false, description: "Whether the CTA is submitting.", source: "app-state" },
      { name: "selectedPlan", type: "string", defaultValue: "Pro", description: "Selected pricing plan label.", source: "app-state" },
      { name: "isSubscribed", type: "boolean", defaultValue: false, description: "Whether checkout has completed successfully.", source: "app-state" }
    ];
  }
  if (kind === "daily-streak") {
    return [
      { name: "count", type: "number", defaultValue: 17, description: "Current streak count driving count blend motion.", source: "game-state" },
      { name: "rewardLevel", type: "enum", defaultValue: "base", description: "Reward intensity tier for burst and streak-up motion.", source: "game-state" },
      { name: "isLiked", type: "boolean", defaultValue: false, description: "Heart button selected state.", source: "app-state" },
      { name: "isSyncing", type: "boolean", defaultValue: false, description: "Whether daily streak state is syncing.", source: "app-state" }
    ];
  }
  if (kind === "payment") {
    return [
      { name: "paymentStatus", type: "enum", defaultValue: "idle", description: "Payment state: idle, sending, success, error, or disabled.", source: "app-state" },
      { name: "progress", type: "number", defaultValue: 0, description: "Payment progress from 0 to 1.", source: "app-state" },
      { name: "isLoading", type: "boolean", defaultValue: false, description: "Whether the payment is sending.", source: "app-state" },
      { name: "balanceState", type: "enum", defaultValue: "normal", description: "Balance status for payment feedback.", source: "app-state" }
    ];
  }
  if (kind === "unity-menu") {
    return [
      { name: "isFocused", type: "boolean", defaultValue: false, description: "Whether the menu button has pointer or controller focus.", source: "game-state" },
      { name: "selectedIndex", type: "number", defaultValue: 0, description: "Selected menu index for controller navigation.", source: "game-state" },
      { name: "isLoading", type: "boolean", defaultValue: false, description: "Whether a scene is loading after Play.", source: "game-state" }
    ];
  }
  return [
    { name: "isSelected", type: "boolean", defaultValue: false, description: "Whether the primary interactive element is selected.", source: "app-state" },
    { name: "isLoading", type: "boolean", defaultValue: false, description: "Whether the page is waiting on async work.", source: "app-state" },
    { name: "progress", type: "number", defaultValue: 0, description: "Generic progress value for loading or completion motion.", source: "app-state" }
  ];
}

function layerTemplatesForSurface(surface: PageSurface, brief?: string): LayerTemplate[] {
  const route = routeLayer();
  if (surface.kind === "route-shell") return [route];
  if (surface.kind === "motion-mcp-product") {
    return [
      route,
      pipelineLayer(),
      toolCardsLayer(),
      billingLayer()
    ];
  }
  if (surface.kind === "pulseforge-landing") {
    return [
      route,
      logoLayer(),
      ctaLayer(),
      pricingLayer()
    ];
  }
  if (surface.kind === "daily-streak") {
    return [
      route,
      heartLayer(),
      streakCountLayer(),
      streakScreenLayer()
    ];
  }
  if (surface.kind === "payment") {
    return [
      route,
      paymentButtonLayer(),
      paymentFeedbackLayer()
    ];
  }
  if (surface.kind === "unity-menu") {
    return [
      menuButtonLayer(),
      gameControllerLayer()
    ];
  }
  return [
    route,
    genericInteractionLayer(surface.name),
    genericFeedbackLayer(brief)
  ];
}

function routeLayer(): LayerTemplate {
  return {
    name: "Route Lifecycle",
    description: "Rive-style entry/active/exiting lifecycle for page-level motion.",
    ownedParts: ["page-shell", "route-content"],
    states: [
      { name: "Entry", kind: "entry", description: "Initial route mount handoff.", parts: ["page-shell"] },
      { name: "Entering", kind: "single", description: "Short fade/slide into stable layout.", parts: ["route-content"] },
      { name: "Active", kind: "single", description: "Resting page state.", parts: ["page-shell", "route-content"] },
      { name: "Exiting", kind: "single", description: "Route handoff out of the page.", parts: ["route-content"] },
      { name: "Reduced Motion", kind: "any", description: "Accessible override that can be reached from any state.", parts: ["page-shell"] },
      { name: "Exit", kind: "exit", description: "Stop route lifecycle layer.", parts: ["page-shell"] }
    ]
  };
}

function pipelineLayer(): LayerTemplate {
  return {
    name: "Pipeline Panel",
    description: "Scan to app-map to SVG lane to generated state machine progression.",
    ownedParts: ["pipeline-panel", "scan-node", "motion-map-node", "svg-lane-node", "state-machine-node", "connector-lines"],
    states: [
      { name: "Idle", kind: "single", description: "Panel rests with scan highlighted.", parts: ["pipeline-panel", "scan-node"] },
      { name: "Scan", kind: "single", description: "Codebase scan node activates.", parts: ["scan-node", "connector-lines"] },
      { name: "Motion Map", kind: "single", description: "App motion map node activates.", parts: ["motion-map-node", "connector-lines"] },
      { name: "SVG Lane", kind: "single", description: "Simple or premium SVG lane node activates.", parts: ["svg-lane-node", "connector-lines"] },
      { name: "Animation", kind: "single", description: "State-machine node activates.", parts: ["state-machine-node", "connector-lines"] },
      { name: "Applied", kind: "single", description: "Pipeline lands in success/apply state.", parts: ["pipeline-panel", "state-machine-node"] },
      { name: "Error", kind: "single", description: "Pipeline shows recoverable error.", parts: ["pipeline-panel"] }
    ]
  };
}

function toolCardsLayer(): LayerTemplate {
  return {
    name: "Tool Cards",
    description: "Repeated MCP tool cards with pointer and selected states.",
    ownedParts: ["tool-card", "tool-icon", "tool-title", "tool-description"],
    states: [
      { name: "Idle", kind: "single", description: "Cards are still and scannable.", parts: ["tool-card"] },
      { name: "Hover", kind: "single", description: "Card lifts and icon brightens.", parts: ["tool-card", "tool-icon"] },
      { name: "Pressed", kind: "single", description: "Card compresses on press.", parts: ["tool-card"] },
      { name: "Selected", kind: "single", description: "Selected tool card remains accented.", parts: ["tool-card", "tool-title"] },
      { name: "Unavailable", kind: "single", description: "Unsupported tool card dims.", parts: ["tool-card", "tool-description"] },
      { name: "Success", kind: "single", description: "Tool card confirms completion.", parts: ["tool-card", "tool-icon"] }
    ]
  };
}

function billingLayer(): LayerTemplate {
  return {
    name: "Billing Credits",
    description: "Credit balance, reservation, commit, refund, and failure states.",
    ownedParts: ["billing-block", "credit-icon", "balance-text", "status-copy"],
    states: [
      { name: "Credit Balance", kind: "single", description: "Stable balance display.", parts: ["balance-text", "credit-icon"] },
      { name: "Reserving", kind: "single", description: "Credits are reserved before premium generation.", parts: ["billing-block", "credit-icon"] },
      { name: "Committed", kind: "single", description: "Credits commit after usable SVG or diff.", parts: ["billing-block", "status-copy"] },
      { name: "Refunded", kind: "single", description: "Reservation returns after failed provider call.", parts: ["billing-block", "status-copy"] },
      { name: "Error", kind: "single", description: "Billing failure with recovery state.", parts: ["billing-block"] }
    ]
  };
}

function logoLayer(): LayerTemplate {
  return {
    name: "Brand Logo",
    description: "PulseForge logo teaches brand personality without moving layout.",
    ownedParts: ["logo-mark", "outer-orbit", "spark-core", "brand-glow"],
    states: [
      { name: "Idle Breathe", kind: "single", description: "Subtle breathing brand mark.", parts: ["logo-mark", "brand-glow"] },
      { name: "Hover Glow", kind: "single", description: "Glow and orbit respond to focus.", parts: ["outer-orbit", "brand-glow"] },
      { name: "Active Orbit", kind: "single", description: "Orbit energizes while CTA is active.", parts: ["outer-orbit"] },
      { name: "Success Spark", kind: "single", description: "Spark confirms action completion.", parts: ["spark-core", "brand-glow"] },
      { name: "Error Dim", kind: "single", description: "Logo settles during recoverable error.", parts: ["logo-mark"] }
    ]
  };
}

function ctaLayer(): LayerTemplate {
  return {
    name: "Primary CTA",
    description: "Start today button with Rive-style button states.",
    ownedParts: ["cta-button", "cta-label", "press-shadow", "loading-ring", "success-check"],
    states: [
      { name: "Idle", kind: "single", description: "Button rests in primary state.", parts: ["cta-button", "cta-label"] },
      { name: "Hover", kind: "single", description: "Button lifts and shadow expands.", parts: ["cta-button", "press-shadow"] },
      { name: "Pressed", kind: "single", description: "Button compresses.", parts: ["cta-button", "press-shadow"] },
      { name: "Loading", kind: "single", description: "Loading ring replaces passive affordance.", parts: ["loading-ring"] },
      { name: "Success", kind: "single", description: "Check and label confirmation.", parts: ["success-check", "cta-label"] },
      { name: "Error", kind: "single", description: "Short shake with retry affordance.", parts: ["cta-button"] },
      { name: "Disabled", kind: "single", description: "Disabled, low-opacity state.", parts: ["cta-button", "cta-label"] }
    ]
  };
}

function pricingLayer(): LayerTemplate {
  return {
    name: "Pricing Card",
    description: "Plan selection and subscription feedback.",
    ownedParts: ["pricing-card", "plan-label", "price-text", "billing-status"],
    states: [
      { name: "Unselected", kind: "single", description: "Neutral pricing card.", parts: ["pricing-card"] },
      { name: "Selected", kind: "single", description: "Pro plan is selected.", parts: ["pricing-card", "plan-label"] },
      { name: "Billing Pending", kind: "single", description: "Checkout or subscription is pending.", parts: ["billing-status"] },
      { name: "Subscribed", kind: "single", description: "Subscription completes.", parts: ["pricing-card", "billing-status"] },
      { name: "Failed", kind: "single", description: "Payment failure recovery state.", parts: ["pricing-card", "billing-status"] }
    ]
  };
}

function heartLayer(): LayerTemplate {
  return {
    name: "Heart Button",
    description: "Daily streak heart interaction with reward burst.",
    ownedParts: ["heart-shell", "heart-fill", "heart-outline", "sparkles"],
    states: [
      { name: "Idle", kind: "single", description: "Heart awaits press.", parts: ["heart-outline"] },
      { name: "Pressed", kind: "single", description: "Heart compresses under touch.", parts: ["heart-shell", "heart-fill"] },
      { name: "Liked", kind: "single", description: "Heart fills and settles.", parts: ["heart-fill"] },
      { name: "Streak Up", kind: "single", description: "Streak-up pulse after completing day.", parts: ["heart-fill", "sparkles"] },
      { name: "Reward Burst", kind: "additiveBlend", description: "Reward intensity adds sparkle, scale, and color.", parts: ["sparkles", "heart-fill"], additiveProperties: ["rewardLevel", "count"] }
    ]
  };
}

function streakCountLayer(): LayerTemplate {
  return {
    name: "Streak Count",
    description: "Number-driven blend state for count changes.",
    ownedParts: ["count-text", "count-shadow", "progress-glow"],
    states: [
      { name: "Count Blend", kind: "blend1d", description: "Count-up blend driven by streak count.", parts: ["count-text", "progress-glow"], blendProperty: "count", blendRange: { min: 0, max: 365 } },
      { name: "Reward Level", kind: "blend1d", description: "Reward intensity blend driven by reward level mapping.", parts: ["count-shadow", "progress-glow"], blendProperty: "rewardLevel", blendRange: { min: 0, max: 3 } }
    ]
  };
}

function streakScreenLayer(): LayerTemplate {
  return {
    name: "Streak Screen State",
    description: "Screen-level state for sync, completion, missed day, and error recovery.",
    ownedParts: ["screen-shell", "streak-title", "sync-indicator"],
    states: [
      { name: "Loading Sync", kind: "single", description: "Daily streak sync is running.", parts: ["sync-indicator"] },
      { name: "Daily Complete", kind: "single", description: "Daily streak has been completed.", parts: ["screen-shell", "streak-title"] },
      { name: "Missed Day", kind: "single", description: "Missed streak recovery moment.", parts: ["screen-shell", "streak-title"] },
      { name: "Error", kind: "single", description: "Sync error state.", parts: ["sync-indicator"] }
    ]
  };
}

function paymentButtonLayer(): LayerTemplate {
  return {
    name: "Send Payment Button",
    description: "Payment CTA state machine.",
    ownedParts: ["payment-button", "button-label", "press-shadow", "send-icon"],
    states: [
      { name: "Idle", kind: "single", description: "Ready to send payment.", parts: ["payment-button", "button-label"] },
      { name: "Pressed", kind: "single", description: "Button compresses under touch.", parts: ["payment-button", "press-shadow"] },
      { name: "Sending", kind: "single", description: "Payment is submitting.", parts: ["send-icon", "button-label"] },
      { name: "Success", kind: "single", description: "Payment sent.", parts: ["payment-button", "send-icon"] },
      { name: "Error", kind: "single", description: "Payment failed with retry affordance.", parts: ["payment-button"] },
      { name: "Disabled", kind: "single", description: "Payment cannot be sent.", parts: ["payment-button", "button-label"] }
    ]
  };
}

function paymentFeedbackLayer(): LayerTemplate {
  return {
    name: "Payment Feedback Asset",
    description: "Progress and success/error feedback asset.",
    ownedParts: ["progress-ring", "success-check", "error-mark", "balance-chip"],
    states: [
      { name: "Progress Blend", kind: "blend1d", description: "Progress ring follows payment progress.", parts: ["progress-ring"], blendProperty: "progress", blendRange: { min: 0, max: 1 } },
      { name: "Success", kind: "single", description: "Payment success confirmation.", parts: ["success-check", "balance-chip"] },
      { name: "Error", kind: "single", description: "Payment error recovery.", parts: ["error-mark", "balance-chip"] }
    ]
  };
}

function menuButtonLayer(): LayerTemplate {
  return {
    name: "Menu Button",
    description: "Unity play/menu button interaction.",
    ownedParts: ["menu-button", "button-label", "focus-ring", "loading-sweep"],
    states: [
      { name: "Idle", kind: "single", description: "Menu button rests.", parts: ["menu-button", "button-label"] },
      { name: "Hover Focus", kind: "single", description: "Pointer or controller focus.", parts: ["focus-ring", "menu-button"] },
      { name: "Pressed", kind: "single", description: "Button pressed.", parts: ["menu-button"] },
      { name: "Loading Scene", kind: "single", description: "Scene load after play.", parts: ["loading-sweep", "button-label"] },
      { name: "Success", kind: "single", description: "Play accepted.", parts: ["menu-button", "focus-ring"] },
      { name: "Error", kind: "single", description: "Scene load failure.", parts: ["menu-button"] }
    ]
  };
}

function gameControllerLayer(): LayerTemplate {
  return {
    name: "Game Controller Binding",
    description: "Controller navigation and selected index binding.",
    ownedParts: ["selection-cursor", "focus-ring", "menu-button"],
    states: [
      { name: "Index Blend", kind: "blend1d", description: "Selected menu index moves focus indicator.", parts: ["selection-cursor", "focus-ring"], blendProperty: "selectedIndex", blendRange: { min: 0, max: 6 } },
      { name: "Focused", kind: "single", description: "Button is focused.", parts: ["focus-ring"] },
      { name: "Unfocused", kind: "single", description: "Button is not focused.", parts: ["focus-ring"] }
    ]
  };
}

function genericInteractionLayer(name: string): LayerTemplate {
  return {
    name: "Primary Interaction",
    description: `${name} primary interaction states.`,
    ownedParts: ["primary-surface", "primary-label", "feedback-accent"],
    states: [
      { name: "Idle", kind: "single", description: "Primary surface is at rest.", parts: ["primary-surface"] },
      { name: "Hover", kind: "single", description: "Primary surface reveals affordance.", parts: ["primary-surface", "feedback-accent"] },
      { name: "Pressed", kind: "single", description: "Primary surface compresses.", parts: ["primary-surface"] },
      { name: "Active", kind: "single", description: "Primary surface remains selected or active.", parts: ["primary-surface", "primary-label"] },
      { name: "Success", kind: "single", description: "Primary interaction completes.", parts: ["feedback-accent"] },
      { name: "Error", kind: "single", description: "Recoverable error feedback.", parts: ["primary-surface"] }
    ]
  };
}

function genericFeedbackLayer(brief?: string): LayerTemplate {
  return {
    name: "Feedback",
    description: brief ? `Feedback layer informed by brief: ${brief}` : "Generic loading, success, and error feedback.",
    ownedParts: ["progress-parts", "success-parts", "error-parts"],
    states: [
      { name: "Progress Blend", kind: "blend1d", description: "Progress parts bind to app progress.", parts: ["progress-parts"], blendProperty: "progress", blendRange: { min: 0, max: 1 } },
      { name: "Success", kind: "single", description: "Completion feedback.", parts: ["success-parts"] },
      { name: "Error", kind: "single", description: "Recovery feedback.", parts: ["error-parts"] }
    ]
  };
}

function materializeLayer(pageId: string, template: LayerTemplate, order: number): MotionLayer {
  const layerId = stableId("layer", `${pageId}:${template.name}`);
  const states = template.states.map((state) => {
    const stateId = stableId("state", `${layerId}:${state.name}`);
    const unsupported = unsupportedStateReason(state.kind);
    const node: MotionStateNode = {
      stateId,
      name: state.name,
      kind: state.kind,
      timeline: `${template.name}.${state.name}`,
      loop: state.kind === "blend1d" || /idle|breathe|loading/i.test(state.name),
      playbackSpeed: 1,
      blendProperty: state.blendProperty,
      blendRange: state.blendRange,
      additiveProperties: state.additiveProperties,
      controlledParts: state.parts ?? template.ownedParts,
      description: state.description,
      readyForCodegen: !unsupported,
      specOnlyReason: unsupported
    };
    return node;
  });
  return {
    layerId,
    name: template.name,
    order,
    priority: order + 1,
    ownedParts: template.ownedParts,
    initialStateId: states[0]?.stateId ?? stableId("state", `${layerId}:empty`),
    states,
    description: template.description
  };
}

function transitionsForLayer(
  pageId: string,
  layer: MotionLayer,
  viewModel: MotionViewModel
): RiveLikeTransition[] {
  const byName = new Map(layer.states.map((state) => [normalizeName(state.name), state]));
  const transitions: RiveLikeTransition[] = [];
  const add = (
    fromName: string,
    toName: string,
    event: string,
    description: string,
    conditions: MotionCondition[] = [],
    actions: MotionAction[] = [],
    timing = defaultTiming(event)
  ) => {
    const from = byName.get(normalizeName(fromName));
    const to = byName.get(normalizeName(toName));
    if (!from || !to) return;
    const unsupported = unsupportedTransitionReason(to, conditions, actions);
    transitions.push({
      transitionId: stableId("transition", `${pageId}:${layer.layerId}:${from.name}:${to.name}:${event}`),
      fromStateId: from.stateId,
      toStateId: to.stateId,
      layerId: layer.layerId,
      event,
      timing,
      conditions,
      actions,
      description,
      readyForCodegen: !unsupported,
      specOnlyReason: unsupported
    });
  };

  add("Entry", "Entering", "routeEnter", "Route starts page entry motion.", [], [reportAction(pageId, "route_entered", "start")]);
  add("Entering", "Active", "entryComplete", "Entry timeline completes before resting active.", [], [], { durationMs: 220, exitTime: 100, exitTimeUnit: "percent", interpolation: "cubic" });
  add("Active", "Exiting", "routeLeave", "Route begins exit handoff.", [], [reportAction(pageId, "route_exiting", "start")]);
  add("Exiting", "Exit", "exitComplete", "Exit state stops the route lifecycle layer.", [], [], { durationMs: 160, exitTime: 100, exitTimeUnit: "percent", pauseWhenExiting: true, interpolation: "cubic" });
  add("Idle", "Hover", "pointerEnter", "Pointer hover reveals affordance.");
  add("Hover", "Idle", "pointerLeave", "Pointer leave returns to idle.");
  add("Hover", "Pressed", "pressIn", "Press begins anticipation.");
  add("Idle", "Pressed", "pressIn", "Touch press begins anticipation.");
  add("Pressed", "Active", "pressOut", "Press release activates element.", [], [reportAction(pageId, "activated", "end")]);
  add("Pressed", "Liked", "pressOut", "Heart release marks liked.", [booleanCondition(pageId, "isLiked", false)], [setAction(pageId, "isLiked", true)]);
  add("Liked", "Streak Up", "success", "Liked state triggers streak-up reward.", [numberCondition(pageId, "count", "greaterThan", 0)], [reportAction(pageId, "streak_up", "start")]);
  add("Active", "Success", "success", "Active state completes successfully.", [booleanCondition(pageId, "hasError", false)], [reportAction(pageId, "success", "start")]);
  add("Active", "Error", "error", "Active state fails with recovery motion.", [booleanCondition(pageId, "hasError", true)], [reportAction(pageId, "error", "start")]);
  add("Loading", "Success", "success", "Loading completes successfully.", [booleanCondition(pageId, "hasError", false)], [reportAction(pageId, "success", "start")]);
  add("Loading", "Error", "error", "Loading fails and enters recovery motion.", [booleanCondition(pageId, "hasError", true)], [reportAction(pageId, "error", "start")]);
  add("Sending", "Success", "success", "Payment send succeeds.", [enumCondition(pageId, "paymentStatus", "success")], [reportAction(pageId, "payment_success", "start")]);
  add("Sending", "Error", "error", "Payment send fails.", [booleanCondition(pageId, "hasError", true)], [reportAction(pageId, "payment_error", "start")]);
  add("Credit Balance", "Reserving", "reserveCredits", "Credits are reserved before premium calls.", [booleanCondition(pageId, "isReservingCredits", true)]);
  add("Reserving", "Committed", "commitCredits", "Credits commit after usable artifact.", [enumCondition(pageId, "creditState", "committed")], [reportAction(pageId, "credits_committed", "end")]);
  add("Reserving", "Refunded", "refundCredits", "Credits refund on failed artifact.", [enumCondition(pageId, "creditState", "refunded")], [reportAction(pageId, "credits_refunded", "end")]);
  add("Reserving", "Error", "error", "Billing enters recoverable error.", [booleanCondition(pageId, "hasError", true)]);
  add("Loading Sync", "Daily Complete", "success", "Sync completes daily state.", [booleanCondition(pageId, "hasError", false)]);
  add("Loading Sync", "Error", "error", "Sync fails.", [booleanCondition(pageId, "hasError", true)]);
  add("Idle", "Sending", "activate", "Payment button enters sending state.", [enumCondition(pageId, "paymentStatus", "sending")]);
  add("Idle", "Loading Scene", "activate", "Unity menu starts scene load.", [booleanCondition(pageId, "isLoading", true)]);
  add("Loading Scene", "Success", "success", "Scene load accepted.", [booleanCondition(pageId, "hasError", false)]);
  add("Loading Scene", "Error", "error", "Scene load failed.", [booleanCondition(pageId, "hasError", true)]);
  add("Unfocused", "Focused", "focus", "Controller focus enters this menu item.", [booleanCondition(pageId, "isFocused", true)]);
  add("Focused", "Unfocused", "blur", "Controller focus leaves this menu item.", [booleanCondition(pageId, "isFocused", false)]);

  for (const state of layer.states.filter((candidate) => candidate.kind === "blend1d")) {
    const property = state.blendProperty ?? viewModel.properties.find((propertyCandidate) => propertyCandidate.type === "number")?.name ?? "progress";
    const condition = numberCondition(pageId, property, "greaterThanOrEqual", state.blendRange?.min ?? 0);
    const unsupported = unsupportedTransitionReason(state, [condition], []);
    transitions.push({
      transitionId: stableId("transition", `${pageId}:${layer.layerId}:${state.name}:blendUpdate`),
      fromStateId: state.stateId,
      toStateId: state.stateId,
      layerId: layer.layerId,
      event: `${property}Change`,
      timing: { durationMs: 180, interpolation: "cubic" },
      conditions: [condition],
      actions: [],
      description: `${state.name} continuously remaps ${property} through a Rive-style 1D blend.`,
      readyForCodegen: !unsupported,
      specOnlyReason: unsupported
    });
  }

  return transitions;
}

function listenersForSurface(
  pageId: string,
  surface: PageSurface,
  layers: MotionLayer[]
): MotionListener[] {
  const base: MotionListener[] = [
    listener(pageId, "route", "routeEnter", "routeEnter", "page-shell", "Route mount starts entry state."),
    listener(pageId, "route", "routeLeave", "routeLeave", "page-shell", "Route unmount starts exit state."),
    listener(pageId, "visibility", "visible", "entryComplete", "page-shell", "Visibility completes entry when the page is in view.")
  ];
  const text = `${surface.kind} ${surface.file} ${layers.map((layer) => layer.name).join(" ")}`.toLowerCase();
  if (/button|card|cta|heart|tool|pricing|menu/.test(text)) {
    base.push(
      listener(pageId, "pointer", "pointerEnter", "pointerEnter", "primary-surface", "Pointer enter routes to hover/focus states."),
      listener(pageId, "pointer", "pointerLeave", "pointerLeave", "primary-surface", "Pointer leave routes back to idle."),
      listener(pageId, "press", "pressIn", "pressIn", "primary-surface", "Press-in routes to pressed state."),
      listener(pageId, "press", "pressOut", "pressOut", "primary-surface", "Press-out routes to active, liked, sending, or loading states.")
    );
  }
  if (surface.kind === "motion-mcp-product") {
    base.push(listener(pageId, "form", "reserveCredits", "reserveCredits", "billing-block", "Billing reservation drives credit layer."));
  }
  if (surface.kind === "daily-streak") {
    base.push(listener(pageId, "game", "streakUpdated", "success", "count-text", "Streak update triggers reward states."));
  }
  if (surface.kind === "payment") {
    base.push(listener(pageId, "form", "paymentSubmitted", "activate", "payment-button", "Payment submit starts sending state."));
  }
  if (surface.kind === "unity-menu") {
    base.push(
      listener(pageId, "game", "controllerFocus", "focus", "menu-button", "Controller focus enters focused state."),
      listener(pageId, "game", "sceneLoadStarted", "activate", "menu-button", "Scene loading drives loading state.")
    );
  }
  return base;
}

function bindingsForSurface(surface: PageSurface, viewModel: MotionViewModel): MotionBinding[] {
  const targetFor = (property: MotionProperty): string => {
    if (property.name === "routeStatus") return "route-content";
    if (property.name === "currentPipelineStep") return "pipeline-panel";
    if (property.name === "selectedTool") return "tool-card";
    if (property.name === "creditState" || property.name === "isReservingCredits") return "billing-block";
    if (property.name === "count" || property.name === "rewardLevel") return "count-text";
    if (property.name === "isLiked") return "heart-fill";
    if (property.name === "paymentStatus" || property.name === "progress") return "progress-ring";
    if (property.name === "isFocused" || property.name === "selectedIndex") return "focus-ring";
    if (property.type === "color") return "accent-parts";
    if (property.type === "number") return "progress-parts";
    return "primary-parts";
  };
  return viewModel.properties.map((property) => ({
    property: property.name,
    targetPart: targetFor(property),
    source: property.source,
    description: `${property.name} binds ${surface.name} app data to ${targetFor(property)}.`
  }));
}

function codegenReadiness(
  surface: PageSurface,
  layers: MotionLayer[],
  transitions: RiveLikeTransition[]
): StateMachineCodegenReadiness {
  const stableTarget = surface.framework === "next" || surface.framework === "react"
    ? "react"
    : surface.framework === "expo" || surface.framework === "react-native"
      ? "react-native"
      : surface.framework === "flutter"
        ? "flutter"
        : surface.framework === "unity"
          ? "unity"
          : "spec-only";
  const unsupportedFeatures = unique([
    ...layers.flatMap((layer) => layer.states.map((state) => state.specOnlyReason).filter((reason): reason is string => Boolean(reason))),
    ...transitions.map((transition) => transition.specOnlyReason).filter((reason): reason is string => Boolean(reason)),
    ...(stableTarget === "flutter" || stableTarget === "unity" ? [`${stableTarget} target is beta-labeled for state-machine codegen.`] : []),
    ...(stableTarget === "spec-only" ? ["Unknown framework; state-machine experience is spec-only."] : [])
  ]);
  const readyForCodegen = stableTarget === "react" || stableTarget === "react-native";
  return {
    readyForCodegen,
    target: stableTarget,
    supportedFeatures: [
      "single animation states",
      "pointer and press listeners",
      "boolean, enum, number, and trigger conditions",
      "app-state and route-state ViewModel bindings",
      "report-event actions as callback hooks"
    ],
    unsupportedFeatures,
    specOnlyReason: readyForCodegen ? undefined : unsupportedFeatures[0] ?? "This framework is not stable for generated page state-machine code yet."
  };
}

function experienceSummary(surface: PageSurface): string {
  if (surface.kind === "motion-mcp-product") return "A page-level Rive-like experience for the product UI: pipeline progression, tool-card affordance, and credit lifecycle feedback.";
  if (surface.kind === "route-shell") return "A restrained route lifecycle state machine for entering, active, exiting, and reduced-motion page shell behavior.";
  if (surface.kind === "pulseforge-landing") return "A premium landing-page state machine for logo memory, CTA confidence, and pricing/subscription feedback.";
  if (surface.kind === "daily-streak") return "A mobile reward-loop state machine for heart press feedback, streak count blending, and daily completion moments.";
  if (surface.kind === "payment") return "A payment flow state machine for send-button affordance, progress, success, error, and disabled states.";
  if (surface.kind === "unity-menu") return "A Unity menu interaction state machine for pointer/controller focus, press, scene loading, success, and error recovery.";
  return "A generic page-level state machine for route lifecycle, primary interaction, loading, success, and error feedback.";
}

function restraintRulesForSurface(surface: PageSurface, context: AppMotionContext): string[] {
  const base = context.motionThesis.restraintRules.length ? context.motionThesis.restraintRules : [
    "Animate only high-leverage moments by default.",
    "Preserve layout, typography, and existing components.",
    "Respect reduced-motion settings in generated code."
  ];
  if (surface.kind === "route-shell") {
    return ["Do not add standalone visual assets to the shell by default.", ...base.slice(0, 2)];
  }
  return base;
}

function assetNeedsForSurface(surface: PageSurface): string[] {
  if (surface.kind === "motion-mcp-product") return [
    "Pipeline node SVG parts for scan, map, SVG lane, and state machine.",
    "Credit lifecycle icon parts for balance, reserving, committed, refunded, and error states."
  ];
  if (surface.kind === "route-shell") return ["No standalone visual asset by default; use route lifecycle code only."];
  if (surface.kind === "pulseforge-landing") return [
    "Logo SVG with logo-mark, outer-orbit, spark-core, and brand-glow parts.",
    "CTA feedback SVG with loading-ring, success-check, error-shake, and press-shadow parts."
  ];
  if (surface.kind === "daily-streak") return [
    "Heart/reward SVG with heart-fill, heart-outline, sparkles, and reward-burst parts.",
    "Count accent parts for count-up and reward-level blends."
  ];
  if (surface.kind === "payment") return [
    "Payment feedback SVG with progress-ring, success-check, error-mark, and balance-chip parts."
  ];
  if (surface.kind === "unity-menu") return [
    "Menu HUD SVG or Unity UI parts with focus-ring, loading-sweep, selection-cursor, and button-label parts."
  ];
  return ["Primary feedback SVG with progress, success, error, and accent parts."];
}

function unsupportedStateReason(kind: MotionStateKind): string | undefined {
  if (kind === "blend1d") return "1D blend states are represented in the spec; framework-native blend codegen is not stable yet.";
  if (kind === "additiveBlend") return "Additive blend states are represented in the spec; framework-native additive blend codegen is not stable yet.";
  return undefined;
}

function unsupportedTransitionReason(
  to: MotionStateNode,
  conditions: MotionCondition[],
  actions: MotionAction[]
): string | undefined {
  if (to.specOnlyReason) return to.specOnlyReason;
  if (conditions.some((condition) => condition.type === "custom")) return "Custom transition conditions are spec-only in this phase.";
  if (actions.some((action) => action.type === "focus" || action.type === "fireCallback")) return "Focus and fire-callback actions are spec-only in this phase.";
  return undefined;
}

function defaultTiming(event: string): MotionTransitionTiming {
  if (/pressIn|pressOut/.test(event)) return { durationMs: 90, interpolation: "cubic" };
  if (/success|error|reward/.test(event)) return { durationMs: 340, exitTime: 100, exitTimeUnit: "percent", interpolation: "spring" };
  return { durationMs: 180, interpolation: "cubic" };
}

function booleanCondition(pageId: string, property: string, value: boolean): MotionCondition {
  return {
    conditionId: stableId("condition", `${pageId}:${property}:${value}`),
    type: "boolean",
    property,
    operator: "equals",
    value,
    description: `${property} must be ${value}.`
  };
}

function numberCondition(
  pageId: string,
  property: string,
  operator: MotionCondition["operator"],
  value: number
): MotionCondition {
  return {
    conditionId: stableId("condition", `${pageId}:${property}:${operator}:${value}`),
    type: "number",
    property,
    operator,
    value,
    description: `${property} must be ${operator} ${value}.`
  };
}

function enumCondition(pageId: string, property: string, value: string): MotionCondition {
  return {
    conditionId: stableId("condition", `${pageId}:${property}:${value}`),
    type: "enum",
    property,
    operator: "equals",
    value,
    description: `${property} must equal ${value}.`
  };
}

function reportAction(pageId: string, eventName: string, timing: MotionAction["timing"]): MotionAction {
  return {
    actionId: stableId("action", `${pageId}:report:${eventName}:${timing}`),
    type: "reportEvent",
    timing,
    eventName,
    description: `Report ${eventName} to the host app.`
  };
}

function setAction(pageId: string, property: string, value: string | number | boolean): MotionAction {
  return {
    actionId: stableId("action", `${pageId}:set:${property}:${value}`),
    type: "setProperty",
    timing: "start",
    property,
    value,
    description: `Set ${property} to ${value}.`
  };
}

function listener(
  pageId: string,
  type: MotionListener["type"],
  event: string,
  sends: string,
  targetPart: string,
  description: string
): MotionListener {
  return {
    listenerId: stableId("listener", `${pageId}:${type}:${event}:${targetPart}`),
    type,
    event,
    sends,
    targetPart,
    description
  };
}

async function loadOrScan(root: string): Promise<CodebaseScanResult> {
  const cached = await readMotionJson<CodebaseScanResult>(root, "scan.json");
  return cached ?? scanCodebase(root);
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

function routePatternForPath(file: string): string | undefined {
  const appIndex = file.startsWith("app/") ? 0 : file.indexOf("/app/");
  if (appIndex !== -1) {
    const afterApp = file.slice(appIndex + (file.startsWith("app/") ? 4 : 5));
    const route = afterApp
      .replace(/(^|\/)(page|layout|index)\.(tsx|jsx|ts|js)$/, "")
      .replace(/\.(tsx|jsx|ts|js)$/, "")
      .replace(/\/$/, "");
    return route ? `/${route}` : "/";
  }
  const pagesIndex = file.startsWith("pages/") ? 0 : file.indexOf("/pages/");
  if (pagesIndex !== -1) {
    const afterPages = file.slice(pagesIndex + (file.startsWith("pages/") ? 6 : 7));
    const route = afterPages
      .replace(/\/index\.(tsx|jsx|ts|js)$/, "")
      .replace(/^index\.(tsx|jsx|ts|js)$/, "")
      .replace(/\.(tsx|jsx|ts|js)$/, "");
    return route ? `/${route}` : "/";
  }
  return undefined;
}

function displayName(component: ComponentFile): string {
  return component.exportedComponents[0] ?? component.localComponents[0] ?? path.basename(component.path, path.extname(component.path));
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
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

function uniqueByName(items: MotionProperty[]): MotionProperty[] {
  return items.filter((item, index, all) => all.findIndex((candidate) => candidate.name === item.name) === index);
}
