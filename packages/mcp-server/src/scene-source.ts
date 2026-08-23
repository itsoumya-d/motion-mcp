import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeSvgAnatomy } from "@motion-mcp/anatomy-engine";
import {
  compileAmbientLifeScene,
  compileExperienceToScene,
  type SceneArtboard,
  type SceneDoc
} from "@motion-mcp/scene-graph";
import { flattenSvgNodes, parseSvgTree } from "@motion-mcp/svg-parser";
import type {
  AssetIndexResult,
  MotionPlanResult,
  PageStateMachineExperience,
  StateMachineExperienceResult
} from "@motion-mcp/shared-types";
import { nowIso } from "@motion-mcp/shared-types";
import { loadOptionalJson } from "./internals.js";

/**
 * Shared scene resolution: indexed asset → compiled experience SceneDoc
 * (with sourceSvg attached) so capture/preview/export/review share one path.
 */
export async function loadSceneForAsset(
  root: string,
  componentId: string
): Promise<{ doc: SceneDoc; base: string }> {
  const assets = await loadOptionalJson<AssetIndexResult>(root, "assets.json");
  const asset = assets?.assets.find((candidate) => candidate.id === componentId);
  if (!asset || asset.type !== "svg") {
    throw new Error(`No indexed SVG asset found for ${componentId}. Run scan_assets or generate an asset first.`);
  }

  let svgSource: string;
  try {
    svgSource = await fs.readFile(path.join(root, asset.path), "utf8");
  } catch {
    throw new Error(`Asset file missing on disk: ${asset.path}`);
  }

  const planItem: MotionPlanResult["plan"][number] = {
    componentId: asset.id,
    assetId: asset.id,
    file: asset.path,
    framework: "next",
    runtime: ["framer-motion"],
    interactionIdea: `Export motion for ${asset.path}`,
    whyItMatters: "",
    suggestedTrigger: "hover",
    premiumScore: 0,
    estimatedCredits: 0,
    complexity: "low"
  };
  const artboard = await sceneForPlanItem(root, planItem, componentId);
  if (!artboard) {
    throw new Error(`No compiled scene for ${componentId}. Run research_state_machine_experience first so states exist to export.`);
  }
  (artboard as { sourceSvg?: string }).sourceSvg = svgSource;

  const doc: SceneDoc = {
    formatVersion: 1,
    sceneId: `scene_${asset.id}`,
    name: asset.path,
    createdAt: nowIso(),
    artboards: [artboard]
  };
  return { doc, base: path.basename(asset.path, path.extname(asset.path)) };
}

/** Mirrors index.ts's plan→page matching; kept in sync deliberately. */
export async function sceneForPlanItem(
  root: string,
  planItem: MotionPlanResult["plan"][number],
  _componentId: string
): Promise<ReturnType<typeof compileExperienceToScene> | undefined> {
  void _componentId;
  const experience = await loadOptionalJson<StateMachineExperienceResult>(root, "state-machine-experience.json");
  const pages = experience?.pages ?? [];
  if (pages.length === 0) return undefined;
  const normalizedComponentFile = path.basename(planItem.file).toLowerCase();
  const page =
    pages.find((candidate) => path.basename(candidate.file).toLowerCase() === normalizedComponentFile) ??
    pages.find((candidate) => candidate.screenId && candidate.screenId === (planItem as { screenId?: string }).screenId) ??
    pages.find((candidate) => candidate.codegen.readyForCodegen);
  if (!page) return undefined;
  try {
    return compileExperienceToScene(page satisfies PageStateMachineExperience);
  } catch {
    return undefined;
  }
}

/**
 * Ambient-life fallback scene for components without a researched page
 * experience: grammar states over every named part of the asset's own SVG.
 * Guarantees review/capture pipelines work immediately after ingestion.
 */
export async function buildAmbientFallbackDoc(
  root: string,
  componentId: string
): Promise<{ doc: SceneDoc; base: string }> {
  const assets = await loadOptionalJson<AssetIndexResult>(root, "assets.json");
  const asset = assets?.assets.find((candidate) => candidate.id === componentId);
  if (!asset || asset.type !== "svg") {
    throw new Error(`No indexed SVG asset found for ${componentId}.`);
  }
  const svgSource = await fs.readFile(path.join(root, asset.path), "utf8");
  const anatomy = analyzeSvgAnatomy(svgSource);
  const parts = parseSvgTree(svgSource)
    .flatMap(flattenSvgNodes)
    .filter((node) => Boolean(node.id || node.attrs["data-name"] || node.className))
    .map((node) => node.id ?? node.attrs["data-name"] ?? node.nodeId);

  const artboard: SceneArtboard = compileAmbientLifeScene({
    artboardId: `ambient_${asset.id}`,
    name: `${asset.id}`,
    parts,
    capabilities: anatomy.manifest.capabilities.map((capability) => capability.id),
    sourceFile: asset.path
  });
  (artboard as { sourceSvg?: string }).sourceSvg = svgSource;

  return {
    doc: {
      formatVersion: 1,
      sceneId: `scene_${asset.id}`,
      name: asset.path,
      createdAt: nowIso(),
      artboards: [artboard]
    },
    base: path.basename(asset.path, path.extname(asset.path))
  };
}
