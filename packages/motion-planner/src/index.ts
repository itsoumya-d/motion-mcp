import { promises as fs } from "node:fs";
import path from "node:path";
import { scanAssets } from "@motion-mcp/asset-indexer";
import { scanCodebase } from "@motion-mcp/codebase-scanner";
import {
  type AnimationRuntime,
  type AssetIndexResult,
  type AssetInfo,
  type CodebaseScanResult,
  type ComponentFile,
  type FrameworkKind,
  type MotionPlanItem,
  type MotionPlanResult,
  type MotionTrigger,
  type ProjectConcept,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";

export interface PlanMicrointeractionsInput {
  rootPath: string;
  brief?: string;
  focusArea?: string;
}

export async function feedConcept(input: {
  rootPath: string;
  logoSvgPath?: string;
  brandConcept: string;
  brandPersonality: string[];
}): Promise<ProjectConcept> {
  const root = path.resolve(input.rootPath);
  const concept: ProjectConcept = {
    conceptId: stableId("concept", `${input.logoSvgPath ?? ""}:${input.brandConcept}`),
    logoSvgPath: input.logoSvgPath,
    brandConcept: input.brandConcept,
    brandPersonality: input.brandPersonality,
    savedAt: nowIso()
  };
  const dir = path.join(root, ".motion-mcp");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "concept.json"), `${JSON.stringify(concept, null, 2)}\n`, "utf8");
  return concept;
}

export async function planMicrointeractions(
  input: PlanMicrointeractionsInput
): Promise<MotionPlanResult> {
  const root = path.resolve(input.rootPath);
  const scan = await loadOrScan(root);
  const assets = await loadOrIndex(root);
  const concept = await loadConcept(root);
  const candidates: MotionPlanItem[] = [
    ...planForAssets(scan, assets, concept, input),
    ...planForComponents(scan, assets, concept, input)
  ];
  const deduped = dedupeByTarget(candidates)
    .sort((a, b) => b.premiumScore - a.premiumScore)
    .slice(0, 20);
  const result: MotionPlanResult = {
    planId: stableId("plan", `${root}:${input.brief ?? ""}:${nowIso()}`),
    rootPath: root,
    plan: deduped,
    totalEstimatedCredits: deduped.reduce((sum, item) => sum + item.estimatedCredits, 0),
    createdAt: nowIso()
  };
  await fs.mkdir(path.join(root, ".motion-mcp"), { recursive: true });
  await fs.writeFile(path.join(root, ".motion-mcp", "plan.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function loadOrScan(root: string): Promise<CodebaseScanResult> {
  const cached = await readJson<CodebaseScanResult>(path.join(root, ".motion-mcp", "scan.json"));
  return cached ?? scanCodebase(root);
}

async function loadOrIndex(root: string): Promise<AssetIndexResult> {
  const cached = await readJson<AssetIndexResult>(path.join(root, ".motion-mcp", "assets.json"));
  return cached ?? scanAssets(root);
}

async function loadConcept(root: string): Promise<ProjectConcept | undefined> {
  return readJson<ProjectConcept>(path.join(root, ".motion-mcp", "concept.json"));
}

function planForAssets(
  scan: CodebaseScanResult,
  assets: AssetIndexResult,
  concept: ProjectConcept | undefined,
  input: PlanMicrointeractionsInput
): MotionPlanItem[] {
  return assets.assets.map((asset) => {
    const score = scoreAsset(asset, input, concept);
    const trigger = triggerForAsset(asset);
    const complexity = asset.type === "svg" && (asset.pathTree?.length ?? 0) > 8 ? "high" : score > 80 ? "medium" : "low";
    return {
      componentId: asset.id,
      assetId: asset.id,
      file: asset.path,
      framework: scan.framework,
      runtime: runtimeForFramework(scan.framework, scan.animationLibsPresent),
      interactionIdea: ideaForAsset(asset, trigger, concept),
      whyItMatters: whyAssetMatters(asset, concept),
      suggestedTrigger: trigger,
      premiumScore: score,
      estimatedCredits: creditsFor(complexity, asset.type === "svg" ? asset.semanticLabels.length : 1),
      complexity
    };
  });
}

function planForComponents(
  scan: CodebaseScanResult,
  assets: AssetIndexResult,
  concept: ProjectConcept | undefined,
  input: PlanMicrointeractionsInput
): MotionPlanItem[] {
  return scan.componentFiles.map((component) => {
    const score = scoreComponent(component, input, concept);
    const trigger = triggerForComponent(component);
    const complexity = component.usesSvg || component.usesLottie || component.usesRive ? "medium" : "low";
    return {
      componentId: component.id,
      file: component.path,
      framework: component.framework === "unknown" ? scan.framework : component.framework,
      runtime: runtimeForFramework(component.framework === "unknown" ? scan.framework : component.framework, scan.animationLibsPresent),
      interactionIdea: ideaForComponent(component, trigger, assets),
      whyItMatters: whyComponentMatters(component, concept),
      suggestedTrigger: trigger,
      premiumScore: score,
      estimatedCredits: creditsFor(complexity, component.detectedElements.length),
      complexity
    };
  });
}

function scoreAsset(
  asset: AssetInfo,
  input: PlanMicrointeractionsInput,
  concept?: ProjectConcept
): number {
  const haystack = `${asset.path} ${asset.semanticLabels.join(" ")} ${input.brief ?? ""} ${input.focusArea ?? ""}`.toLowerCase();
  let score = 45;
  if (asset.type === "svg") score += 15;
  if (/logo|brand|mark/.test(haystack)) score += 25;
  if (/heart|like|favorite|bookmark|star/.test(haystack)) score += 22;
  if (/loader|loading|spinner|progress/.test(haystack)) score += 20;
  if (/success|check|complete|done/.test(haystack)) score += 18;
  if (/empty|blank|zero/.test(haystack)) score += 12;
  if (concept?.logoSvgPath && asset.path.endsWith(concept.logoSvgPath)) score += 18;
  return clamp(score);
}

function scoreComponent(
  component: ComponentFile,
  input: PlanMicrointeractionsInput,
  concept?: ProjectConcept
): number {
  const haystack = `${component.path} ${component.exportedComponents.join(" ")} ${component.localComponents.join(" ")} ${component.detectedElements.join(" ")} ${input.brief ?? ""} ${input.focusArea ?? ""}`.toLowerCase();
  let score = 40;
  if (/button|cta|submit|send|buy|checkout/.test(haystack)) score += 25;
  if (/nav|tab|menu|sidebar/.test(haystack)) score += 15;
  if (/card|pricing|plan/.test(haystack)) score += 15;
  if (/modal|sheet|dialog|drawer/.test(haystack)) score += 13;
  if (/counter|score|streak|badge|xp|points/.test(haystack)) score += 25;
  if (/empty|loading|skeleton|success|error/.test(haystack)) score += 18;
  if (component.usesSvg || component.usesIconLibrary) score += 10;
  if (component.usesLottie || component.usesRive) score += 8;
  if (concept?.brandPersonality.some((word) => haystack.includes(word.toLowerCase()))) score += 7;
  return clamp(score);
}

function triggerForAsset(asset: AssetInfo): MotionTrigger {
  const text = `${asset.path} ${asset.semanticLabels.join(" ")}`.toLowerCase();
  if (/loader|loading|spinner|progress/.test(text)) return "idle";
  if (/success|check|done|complete/.test(text)) return "success";
  if (/error|warning|alert/.test(text)) return "error";
  if (/heart|like|favorite|bookmark|star/.test(text)) return "tap";
  if (/logo|brand/.test(text)) return "hover";
  return "hover";
}

function triggerForComponent(component: ComponentFile): MotionTrigger {
  const text = `${component.path} ${component.exportedComponents.join(" ")} ${component.localComponents.join(" ")}`.toLowerCase();
  if (/loading|skeleton/.test(text)) return "idle";
  if (/success|complete/.test(text)) return "success";
  if (/error|warning/.test(text)) return "error";
  if (/button|cta|like|heart|send/.test(text)) return "tap";
  if (/tab|nav|card|pricing/.test(text)) return "hover";
  return "hover";
}

function ideaForAsset(asset: AssetInfo, trigger: MotionTrigger, concept?: ProjectConcept): string {
  const labelText = asset.semanticLabels.join(", ") || "vector parts";
  const personality = concept?.brandPersonality.slice(0, 3).join(", ");
  if (asset.type === "svg") {
    return `Animate ${path.basename(asset.path)} path-by-path on ${trigger}: staggered draw-in, subtle spring scale, and labeled part choreography for ${labelText}${personality ? ` with a ${personality} feel` : ""}.`;
  }
  if (asset.type === "lottie") {
    return `Wrap ${path.basename(asset.path)} with trigger-aware playback states for ${trigger}, including idle, active, and completion segments.`;
  }
  if (asset.type === "rive") {
    return `Wire ${path.basename(asset.path)} into runtime state-machine inputs so app state can drive premium ${trigger} feedback.`;
  }
  return `Add a lightweight ${trigger} transition and responsive polish around ${path.basename(asset.path)}.`;
}

function ideaForComponent(
  component: ComponentFile,
  trigger: MotionTrigger,
  assets: AssetIndexResult
): string {
  const assetHint = assets.assets.find((asset) => component.path.toLowerCase().includes(path.basename(asset.path, path.extname(asset.path)).toLowerCase()));
  const assetClause = assetHint ? ` and coordinate with ${assetHint.path}` : "";
  return `Enhance ${displayComponentName(component)} with ${trigger}-driven micro-interactions: anticipation, spring response, reduced-motion fallback${assetClause}.`;
}

function whyAssetMatters(asset: AssetInfo, concept?: ProjectConcept): string {
  if (/logo|brand|mark/.test(`${asset.path} ${asset.semanticLabels.join(" ")}`.toLowerCase())) {
    return `The brand mark is a high-leverage place for motion; it teaches the product personality without touching layout.`;
  }
  if (concept) {
    return `This asset can reinforce the saved concept: ${concept.brandConcept}.`;
  }
  return `This asset is self-contained, so it can gain motion with low blast radius.`;
}

function whyComponentMatters(component: ComponentFile, concept?: ProjectConcept): string {
  const name = displayComponentName(component);
  if (/button|cta|submit|send|buy|checkout/i.test(name)) {
    return `Primary actions are where users feel product quality most directly.`;
  }
  if (/counter|score|streak|badge/i.test(name)) {
    return `Progress feedback benefits from motion because it turns state changes into reward.`;
  }
  if (concept) {
    return `This component can express the product personality: ${concept.brandPersonality.join(", ")}.`;
  }
  return `This component is a visible interaction surface with good motion leverage.`;
}

function runtimeForFramework(
  framework: FrameworkKind,
  present: AnimationRuntime[]
): AnimationRuntime[] {
  const has = (runtime: AnimationRuntime) => present.includes(runtime);
  if (framework === "next" || framework === "react") {
    return [has("framer-motion") ? "framer-motion" : "framer-motion", has("gsap") ? "gsap" : "css"];
  }
  if (framework === "react-native" || framework === "expo") {
    return [has("reanimated") ? "reanimated" : "reanimated", has("react-native-svg") ? "react-native-svg" : "react-native-svg"];
  }
  if (framework === "flutter") {
    return ["flutter-animation", "custom-painter", has("rive") ? "rive" : "rive"];
  }
  if (framework === "unity") {
    return ["dotween", "unity-animator", "rive"];
  }
  return ["none"];
}

function creditsFor(complexity: MotionPlanItem["complexity"], partCount: number): number {
  const base = complexity === "high" ? 120 : complexity === "medium" ? 80 : 45;
  return Math.min(180, base + Math.max(0, partCount - 4) * 4);
}

function dedupeByTarget(items: MotionPlanItem[]): MotionPlanItem[] {
  const seen = new Set<string>();
  const output: MotionPlanItem[] = [];
  for (const item of items) {
    const key = `${item.file}:${item.suggestedTrigger}`;
    if (!seen.has(key)) {
      output.push(item);
      seen.add(key);
    }
  }
  return output;
}

function displayComponentName(component: ComponentFile): string {
  return component.exportedComponents[0] ?? component.localComponents[0] ?? path.basename(component.path);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
