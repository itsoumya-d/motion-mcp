import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeSvgAnatomy, buildCharacterRig } from "@motion-mcp/anatomy-engine";
import { compileAmbientLifeScene } from "@motion-mcp/scene-graph";
import type { SceneArtboard } from "@motion-mcp/scene-graph";
import { consumeCredits } from "@motion-mcp/credits-ledger";
import { flattenSvgNodes, parseSvgTree } from "@motion-mcp/svg-parser";
import type {
  AssetIndexResult,
  FileChange,
  GeneratedMotionDiff,
  MotionPlanResult
} from "@motion-mcp/shared-types";
import { nowIso, stableId } from "@motion-mcp/shared-types";
import {
  emitForFramework,
  loadOptionalJson,
  toUnifiedDiff,
  writeDiff
} from "./internals.js";
import { attachStoredBindings } from "./bindings.js";

export interface AppLifeInput {
  intensity?: "subtle" | "expressive" | "hero";
  scope?: "all" | "characters";
  maxComponents?: number;
}

export interface AppLifeComponentReport {
  componentId: string;
  assetPath: string;
  speciesId: string;
  capabilities: string[];
  states: string[];
  partCount: number;
  rigAttached: boolean;
  riggedNow: boolean;
}

export interface AppLifeResult {
  ok: boolean;
  diffId?: string;
  components: AppLifeComponentReport[];
  animatedCount: number;
  skipped: Array<{ componentId: string; reason: string }>;
  creditsConsumed: number;
  summary: string;
  nextTool: "apply_motion_diff";
}

const DEFAULT_MAX_COMPONENTS = 12;

/**
 * A3 ambient-life sweep: gives every indexed SVG asset a living idle presence.
 * For each asset it detects anatomy (auto-rigging characters along the way),
 * compiles an ambient SceneDoc artboard (idle-breathe / hover-lift /
 * press-squash plus capability extras), and stages ALL generated framework
 * code into one reviewable diff. Nothing applies until apply_motion_diff.
 */
export async function animateAppLife(
  root: string,
  input: AppLifeInput = {}
): Promise<AppLifeResult> {
  const assets = await loadOptionalJson<AssetIndexResult>(root, "assets.json");
  if (!assets || assets.assets.length === 0) {
    return emptyResult("No indexed assets found. Run scan_assets or generate assets first.");
  }

  const scope = input.scope ?? "all";
  const maxComponents = Math.max(1, input.maxComponents ?? DEFAULT_MAX_COMPONENTS);

  const skipped: AppLifeResult["skipped"] = [];
  const selected: Array<{
    asset: AssetIndexResult["assets"][number];
    svgSource: string;
    anatomy: ReturnType<typeof analyzeSvgAnatomy>;
  }> = [];

  for (const asset of assets.assets.filter((candidate) => candidate.type === "svg")) {
    if (selected.length >= maxComponents) {
      skipped.push({ componentId: asset.id, reason: `maxComponents (${maxComponents}) reached` });
      continue;
    }
    let svgSource: string;
    try {
      svgSource = await fs.readFile(path.join(root, asset.path), "utf8");
    } catch {
      skipped.push({ componentId: asset.id, reason: `asset file missing: ${asset.path}` });
      continue;
    }
    const anatomy = analyzeSvgAnatomy(svgSource);
    if (scope === "characters" && anatomy.parts.length < 2) {
      skipped.push({ componentId: asset.id, reason: "scope=characters and fewer than two anatomical roles detected" });
      continue;
    }
    selected.push({ asset, svgSource, anatomy });
  }

  if (selected.length === 0) {
    return emptyResult(
      skipped.length > 0 ? "No eligible SVG assets passed the scope filter." : "No SVG assets available."
    );
  }

  await consumeCredits(root, {
    amount: 5 * selected.length,
    reason: `animate_app_life:${selected.length}-components`
  });

  const files: FileChange[] = [];
  const components: AppLifeComponentReport[] = [];
  const intensity = input.intensity ?? "expressive";

  for (const entry of selected) {
    const namedParts = parseSvgTree(entry.svgSource)
      .flatMap(flattenSvgNodes)
      .filter((node) => Boolean(node.id || node.attrs["data-name"] || node.className))
      .map((node) => node.id ?? node.attrs["data-name"] ?? node.nodeId);

    const rigRecord = await ensureRig(root, entry.asset, entry.svgSource);
    const capabilities = entry.anatomy.manifest.capabilities.map((capability) => capability.id);
    const scene = compileAmbientLifeScene({
      artboardId: `ambient_${entry.asset.id}`,
      name: `${entry.asset.id} ambient life`,
      parts: namedParts,
      capabilities,
      sourceFile: entry.asset.path
    });
    if (rigRecord?.rig) scene.rig = rigRecord.rig;
    await attachStoredBindings(root, entry.asset.id, scene);

    const planItem: MotionPlanResult["plan"][number] = {
      componentId: entry.asset.id,
      assetId: entry.asset.id,
      file: entry.asset.path,
      framework: "next",
      runtime: ["framer-motion"],
      interactionIdea: `Ambient life: idle breathe, hover lift, press squash${capabilities.length > 0 ? `, ${capabilities.join(", ")}` : ""}.`,
      whyItMatters: "App-wide ambient motion keeps every surface alive without user action.",
      suggestedTrigger: "idle",
      premiumScore: 80,
      estimatedCredits: 5,
      complexity: "low"
    };

    files.push(
      ...emitForFramework("react", {
        planItem,
        asset: entry.asset,
        options: { trigger: "idle", intensity },
        scene
      })
    );

    components.push({
      componentId: entry.asset.id,
      assetPath: entry.asset.path,
      speciesId: scene.rig?.speciesId ?? entry.anatomy.manifest.speciesId,
      capabilities,
      states: Object.values(scene.clips).map((clip) => clip.name),
      partCount: namedParts.length,
      rigAttached: Boolean(rigRecord),
      riggedNow: Boolean(rigRecord?.createdNow)
    });
  }

  const diffId = stableId("diff", `app-life:${nowIso()}`);
  const diff: GeneratedMotionDiff = {
    diffId,
    rootPath: root,
    componentId: "app-life-sweep",
    summary: `Ambient-life sweep: ${components.length} component(s) — idle breathe, hover lift, press squash${intensity !== "expressive" ? ` (${intensity})` : ""}.`,
    framework: "react",
    creditsConsumed: 5 * selected.length,
    validationStatus: {
      ok: true,
      skipped: true,
      reason: "Validation runs after apply_motion_diff because generated files are staged as a reviewable diff."
    },
    files,
    unifiedDiff: toUnifiedDiff(files),
    createdAt: nowIso()
  };
  await writeDiff(root, diff);

  return {
    ok: true,
    diffId,
    components,
    animatedCount: components.length,
    skipped,
    creditsConsumed: diff.creditsConsumed,
    summary: diff.summary,
    nextTool: "apply_motion_diff"
  };
}

interface RigRecordShape {
  assetId?: string;
  speciesId?: string;
  rig?: SceneArtboard["rig"];
}

/**
 * Loads the persisted rig for an asset or rigs it on the fly and persists it.
 * The sweep therefore leaves every character with a reusable rig artifact.
 */
async function ensureRig(
  root: string,
  asset: AssetIndexResult["assets"][number],
  svgSource: string
): Promise<(RigRecordShape & { createdNow?: boolean }) | undefined> {
  const rigPath = path.join(root, ".motion-mcp", "rigs", `${asset.id}.json`);
  try {
    const parsed = JSON.parse(await fs.readFile(rigPath, "utf8")) as RigRecordShape;
    return { ...parsed, createdNow: false };
  } catch {
    // fall through to on-the-fly rigging
  }
  const built = buildCharacterRig(svgSource);
  const record: RigRecordShape & { createdAt: string; createdNow: boolean } = {
    assetId: asset.id,
    speciesId: built.rig.speciesId,
    rig: built.rig,
    createdAt: nowIso(),
    createdNow: true
  };
  await fs.mkdir(path.dirname(rigPath), { recursive: true });
  await fs.writeFile(rigPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function emptyResult(summary: string): AppLifeResult {
  return {
    ok: false,
    components: [],
    animatedCount: 0,
    skipped: [],
    creditsConsumed: 0,
    summary,
    nextTool: "apply_motion_diff"
  };
}
