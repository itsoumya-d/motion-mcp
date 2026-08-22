#!/usr/bin/env node
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  estimateAssetLane,
  getAppMotionContext,
  planScreenMotion,
  researchAppMotion
} from "@motion-mcp/app-researcher";
import { scanAssets } from "@motion-mcp/asset-indexer";
import { autoResearchMotion, type ResearchSourceInput } from "@motion-mcp/auto-researcher";
import { scanCodebase } from "@motion-mcp/codebase-scanner";
import {
  analyzeSvgAnatomy,
  queueAnimation,
  resolveAction
} from "@motion-mcp/anatomy-engine";
import {
  commitCreditReservation,
  consumeCredits,
  getCreditBalance,
  purchaseCreditsUrl,
  refundCreditReservation,
  reserveCredits
} from "@motion-mcp/credits-ledger";
import { emitFlutterAnimation } from "@motion-mcp/emitter-flutter";
import { emitReactAnimation } from "@motion-mcp/emitter-react";
import { emitReactNativeAnimation } from "@motion-mcp/emitter-react-native";
import { emitUnityAnimation } from "@motion-mcp/emitter-unity";
import { feedConcept, planMicrointeractions } from "@motion-mcp/motion-planner";
import { buildWorkoutPlan, EXERCISE_CATALOG } from "@motion-mcp/motion-runtime";
import {
  QuiverProvider,
  motionCreditsForQuiver,
  selectSvgModel
} from "@motion-mcp/quiver-provider";
import {
  flattenSvgNodes,
  parseSvgDimensions,
  parseSvgTree
} from "@motion-mcp/svg-parser";
import {
  type AssetIndexResult,
  type AssetInfo,
  type AssetLaneDecision,
  type FileChange,
  type FrameworkKind,
  type GeneratedMotionDiff,
  type GeneratedSvgAssetResult,
  type GenerateAnimationOptions,
  type MotionCostEstimate,
  type MotionOperation,
  type MotionPlanResult,
  type QuiverUsageRecord,
  type SimpleSvgAssetBriefResult,
  type SvgModelId,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";
import { researchStateMachineExperience } from "@motion-mcp/state-machine-researcher";
import { compileExperienceToScene, type SceneDoc } from "@motion-mcp/scene-graph";
import { importRiv, toSceneSkeleton } from "@motion-mcp/riv-importer";
import { toAnimatedSvg, toLottie } from "@motion-mcp/exporters";
import { captureSceneGif, renderSceneFrames, assembleVideo, hasFfmpeg } from "@motion-mcp/capture";
import type {
  PageStateMachineExperience,
  StateMachineExperienceResult
} from "@motion-mcp/shared-types";
import { validateProject } from "@motion-mcp/validator";

const server = new McpServer({
  name: "motion-mcp",
  version: "0.1.0"
});

const quiver = new QuiverProvider();

const RootSchema = z.object({
  rootPath: z.string().optional().describe("Project root. Defaults to MOTION_MCP_ROOT or current working directory.")
});

const GenerateOptionsSchema = z.object({
  style: z.enum(["playful", "minimal", "corporate", "naughty", "luxury"]).optional(),
  trigger: z.enum(["hover", "tap", "press", "scroll", "idle", "success", "error", "drag", "focus"]).optional(),
  framework: z.enum(["react", "next", "react-native", "expo", "flutter", "unity", "unknown"]).optional(),
  intensity: z.enum(["subtle", "expressive", "hero"]).optional()
});

const SvgModelSchema = z.string().optional().describe("Quiver SVG model. Defaults to arrow-1.1; arrow-1.1-max is selected for dense or technical prompts.");

const MotionOperationSchema = z.enum([
  "generate_svg_asset",
  "generate_premium_svg_asset",
  "vectorize_asset",
  "generate_animation",
  "scan_codebase",
  "scan_assets",
  "auto_research_motion",
  "research_app_motion",
  "research_state_machine_experience",
  "plan_screen_motion",
  "estimate_asset_lane",
  "generate_simple_svg_asset",
  "ingest_svg_asset",
  "plan_microinteractions",
  "validate"
]);

const AssetPlacementSchema = z.object({
  screenId: z.string().optional(),
  flowId: z.string().optional(),
  componentId: z.string().optional(),
  file: z.string().optional(),
  moment: z.string().optional()
}).optional();

type AssetPlacement = z.infer<typeof AssetPlacementSchema>;

server.registerTool(
  "scan_codebase",
  {
    title: "Scan codebase",
    description: "Detect framework, dependencies, entry points, components, icon usage, and animation libraries.",
    inputSchema: RootSchema.shape
  },
  async ({ rootPath }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 5, reason: "scan_codebase" });
    return jsonResult(await scanCodebase(root));
  }
);

server.registerTool(
  "scan_assets",
  {
    title: "Scan assets",
    description: "Index SVG, Lottie, Rive, and image assets. SVGs are decomposed into path trees with semantic labels.",
    inputSchema: RootSchema.shape
  },
  async ({ rootPath }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 10, reason: "scan_assets" });
    return jsonResult(await scanAssets(root));
  }
);

server.registerTool(
  "analyze_svg_anatomy",
  {
    title: "Analyze SVG anatomy",
    description:
      "Species-aware anatomy analysis for an SVG character: detects parts by name or geometry, matches species schemas (human-biped, avian-crow), and reports which actions (blink/wave/flap/caw) the anatomy supports.",
    inputSchema: {
      svg: z.string().min(1).describe("Raw SVG source of the character.")
    }
  },
  async ({ svg }) => jsonResult(analyzeSvgAnatomy(svg))
);

server.registerTool(
  "resolve_anatomy_action",
  {
    title: "Resolve anatomy action",
    description:
      "Resolve a semantic action against an SVG's detected anatomy, or queue a full timeline; returns per-node controller steps (scaleY/rotate/translate with node ids) that host code can turn directly into animation.",
    inputSchema: {
      svg: z.string().min(1),
      action: z.string().optional(),
      timeline: z
        .array(z.object({ action: z.string(), atMs: z.number().int().nonnegative() }))
        .optional()
    }
  },
  async ({ svg, action, timeline }) => {
    const report = analyzeSvgAnatomy(svg);
    return jsonResult({
      manifest: report.manifest,
      parts: report.parts,
      resolvedAction: action ? resolveAction(report, action) : null,
      queue: timeline ? queueAnimation(report, timeline) : null,
      notes: report.notes
    });
  }
);

server.registerTool(
  "curate_workout",
  {
    title: "Curate workout",
    description:
      "Compose a deterministic workout plan from the exercise catalog: balanced moves, no consecutive repeats, mobility cool-down at the end. Returns ordered steps with durations that sum exactly to the requested budget.",
    inputSchema: {
      totalMinutes: z.number().min(1).max(60).default(10),
      focus: z
        .array(z.enum(["strength", "cardio", "mobility"]))
        .optional()
        .describe("Restrict the move pool to these categories."),
      seed: z.number().int().optional().describe("Deterministic variation; same seed, same plan.")
    }
  },
  async ({ totalMinutes, focus, seed }) => {
    const steps = buildWorkoutPlan({
      totalMs: Math.round(totalMinutes * 60000),
      focus,
      seed
    });
    return jsonResult({
      steps,
      labels: Object.fromEntries(
        steps.map((step) => [step.exerciseId, EXERCISE_CATALOG.find((entry) => entry.id === step.exerciseId)?.label ?? step.exerciseId])
      )
    });
  }
);

server.registerTool(
  "feed_concept",
  {
    title: "Feed project concept",
    description: "Teach Motion MCP the app identity and brand personality for future generations.",
    inputSchema: {
      rootPath: z.string().optional(),
      logoSvgPath: z.string().optional(),
      brandConcept: z.string(),
      brandPersonality: z.array(z.string()).default([])
    }
  },
  async ({ rootPath, logoSvgPath, brandConcept, brandPersonality }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await feedConcept({ rootPath: root, logoSvgPath, brandConcept, brandPersonality }));
  }
);

server.registerTool(
  "plan_microinteractions",
  {
    title: "Plan micro-interactions",
    description: "Rank codebase-aware animation opportunities with premium scores and credit estimates.",
    inputSchema: {
      rootPath: z.string().optional(),
      brief: z.string().optional(),
      focusArea: z.string().optional()
    }
  },
  async ({ rootPath, brief, focusArea }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 20, reason: "plan_microinteractions" });
    return jsonResult(await planMicrointeractions({ rootPath: root, brief, focusArea }));
  }
);

server.registerTool(
  "auto_research_motion",
  {
    title: "Auto-research motion",
    description: "Run local source-backed motion/category research, rank implementation opportunities, and build context packs for AI coding agents.",
    inputSchema: {
      rootPath: z.string().optional(),
      brief: z.string().optional(),
      focusPlatforms: z.array(z.enum(["react", "next", "react-native", "expo", "flutter", "unity", "unknown"])).optional(),
      includeSources: z.array(z.object({
        sourceId: z.string().optional(),
        title: z.string(),
        url: z.string(),
        kind: z.enum(["official-doc", "repo", "api-doc", "platform-guideline", "article", "community-reference"]).optional(),
        platforms: z.array(z.string()).optional(),
        topics: z.array(z.string()).optional(),
        summary: z.string().optional(),
        retrievedAt: z.string().optional(),
        confidence: z.number().min(0).max(100).optional(),
        license: z.string().optional()
      })).optional()
    }
  },
  async ({ rootPath, brief, focusPlatforms, includeSources }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 25, reason: "auto_research_motion" });
    return jsonResult(await autoResearchMotion({
      rootPath: root,
      brief,
      focusPlatforms,
      includeSources: includeSources as ResearchSourceInput[] | undefined
    }));
  }
);

server.registerTool(
  "research_app_motion",
  {
    title: "Research app motion",
    description: "Build app-context.json and motion-map.json from routes, screens, components, assets, brand concept, flows, and motion thesis.",
    inputSchema: {
      rootPath: z.string().optional(),
      brief: z.string().optional()
    }
  },
  async ({ rootPath, brief }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 30, reason: "research_app_motion" });
    return jsonResult(await researchAppMotion({ rootPath: root, brief }));
  }
);

server.registerTool(
  "research_state_machine_experience",
  {
    title: "Research state-machine experience",
    description: "Create a page-by-page Rive-like state-machine experience spec with layers, state kinds, transitions, listeners, bindings, and codegen readiness.",
    inputSchema: {
      rootPath: z.string().optional(),
      brief: z.string().optional()
    }
  },
  async ({ rootPath, brief }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 40, reason: "research_state_machine_experience" });
    return jsonResult(await researchStateMachineExperience({ rootPath: root, brief }));
  }
);

server.registerTool(
  "get_app_motion_context",
  {
    title: "Get app motion context",
    description: "Read the current app motion context, researching the app if no context exists yet.",
    inputSchema: RootSchema.shape
  },
  async ({ rootPath }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await getAppMotionContext(root));
  }
);

server.registerTool(
  "plan_screen_motion",
  {
    title: "Plan screen motion",
    description: "Return the highest-leverage motion opportunities for a screen or flow from the app motion map.",
    inputSchema: {
      rootPath: z.string().optional(),
      screenId: z.string().optional(),
      flowId: z.string().optional()
    }
  },
  async ({ rootPath, screenId, flowId }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 15, reason: "plan_screen_motion" });
    return jsonResult(await planScreenMotion({ rootPath: root, screenId, flowId }));
  }
);

server.registerTool(
  "estimate_asset_lane",
  {
    title: "Estimate asset lane",
    description: "Decide whether a requested asset should use the simple host-model lane or the premium QuiverAI lane.",
    inputSchema: {
      rootPath: z.string().optional(),
      screenId: z.string(),
      assetBrief: z.string()
    }
  },
  async ({ rootPath, screenId, assetBrief }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 3, reason: "estimate_asset_lane" });
    return jsonResult(await estimateAssetLane({ rootPath: root, screenId, assetBrief }));
  }
);

server.registerTool(
  "generate_simple_svg_asset",
  {
    title: "Generate simple SVG asset",
    description: "Return a strict host-agent SVG brief for simple assets, or ingest a supplied SVG into Motion MCP when provided.",
    inputSchema: {
      rootPath: z.string().optional(),
      assetBrief: z.string(),
      placement: AssetPlacementSchema,
      svg: z.string().optional().describe("Optional SVG produced by the host coding model. If omitted, this tool returns the strict SVG generation brief.")
    }
  },
  async ({ rootPath, assetBrief, placement, svg }) => {
    const root = resolveRoot(rootPath);
    if (!svg) {
      await consumeCredits(root, { amount: 3, reason: "generate_simple_svg_asset:brief" });
      return jsonResult(await buildSimpleSvgBrief(root, { assetBrief, placement }));
    }
    return jsonResult(await ingestSvgAsset(root, {
      svg,
      source: "generated",
      placement,
      prompt: assetBrief,
      creditAmount: 12,
      creditReason: "generate_simple_svg_asset:ingest"
    }));
  }
);

server.registerTool(
  "generate_premium_svg_asset",
  {
    title: "Generate premium SVG asset",
    description: "Use QuiverAI for high-fidelity, multi-part, brand-critical SVG assets and stage the result as a reviewable diff.",
    inputSchema: {
      rootPath: z.string().optional(),
      assetBrief: z.string(),
      placement: AssetPlacementSchema,
      model: SvgModelSchema,
      stylePreset: z.string().optional().describe("Premium style preset id. One of: kids-storybook, soft-toy, flat-sticker, manipulative.")
    }
  },
  async ({ rootPath, assetBrief, placement, model, stylePreset }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await generatePremiumSvgAsset(root, {
      assetBrief,
      placement,
      model: model as SvgModelId | undefined,
      stylePreset: stylePreset as StylePresetId | undefined
    }));
  }
);

server.registerTool(
  "ingest_svg_asset",
  {
    title: "Ingest SVG asset",
    description: "Normalize, validate, index, and stage an SVG from the user or host agent so it can receive state-machine animation.",
    inputSchema: {
      rootPath: z.string().optional(),
      svg: z.string(),
      source: z.enum(["user", "simple", "generated", "quiver", "vectorized"]).default("generated"),
      placement: AssetPlacementSchema
    }
  },
  async ({ rootPath, svg, source, placement }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await ingestSvgAsset(root, {
      svg,
      source: source === "quiver" || source === "vectorized" ? source : "generated",
      placement,
      prompt: placementLabel(placement) || "ingested svg asset",
      creditAmount: 8,
      creditReason: "ingest_svg_asset"
    }));
  }
);

server.registerTool(
  "list_svg_models",
  {
    title: "List SVG models",
    description: "List QuiverAI SVG models with live or fallback pricing credits.",
    inputSchema: {}
  },
  async () => jsonResult(await quiver.listModels())
);

server.registerTool(
  "estimate_motion_cost",
  {
    title: "Estimate Motion MCP cost",
    description: "Estimate Motion credits before a Quiver or animation operation.",
    inputSchema: {
      rootPath: z.string().optional(),
      planItemId: z.string().optional(),
      operation: MotionOperationSchema,
      model: SvgModelSchema
    }
  },
  async ({ rootPath, planItemId, operation, model }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await estimateMotionCost(root, operation, planItemId, model as SvgModelId | undefined));
  }
);

server.registerTool(
  "generate_svg_asset",
  {
    title: "Generate SVG asset",
    description: "Use QuiverAI to create a structured SVG asset, charge Motion credits, and stage the file as a reviewable diff.",
    inputSchema: {
      rootPath: z.string().optional(),
      prompt: z.string(),
      instructions: z.string().optional(),
      references: z.array(z.string()).default([]),
      model: SvgModelSchema,
      n: z.number().int().min(1).max(4).optional()
    }
  },
  async ({ rootPath, prompt, instructions, references, model, n }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await generateSvgAsset(root, {
      prompt,
      instructions,
      references,
      model: model as SvgModelId | undefined,
      n
    }));
  }
);

server.registerTool(
  "vectorize_asset",
  {
    title: "Vectorize asset",
    description: "Use QuiverAI to convert an existing image asset into an SVG and stage it as a reviewable diff.",
    inputSchema: {
      rootPath: z.string().optional(),
      imagePath: z.string(),
      instructions: z.string().optional(),
      model: SvgModelSchema
    }
  },
  async ({ rootPath, imagePath, instructions, model }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await vectorizeAsset(root, {
      imagePath,
      instructions,
      model: model as SvgModelId | undefined
    }));
  }
);

server.registerTool(
  "generate_animation",
  {
    title: "Generate animation",
    description: "Generate a reviewable diff for one approved plan item. Does not apply changes until apply_motion_diff is called.",
    inputSchema: {
      rootPath: z.string().optional(),
      componentId: z.string(),
      options: GenerateOptionsSchema.optional()
    }
  },
  async ({ rootPath, componentId, options }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await generateAnimation(root, componentId, options ?? {}));
  }
);

server.registerTool(
  "apply_motion_diff",
  {
    title: "Apply motion diff",
    description: "Apply a generated diff to the project and run validation when possible.",
    inputSchema: {
      rootPath: z.string().optional(),
      diffId: z.string()
    }
  },
  async ({ rootPath, diffId }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await applyMotionDiff(root, diffId));
  }
);

server.registerTool(
  "preview_animation",
  {
    title: "Preview animation",
    description: "Return local preview metadata for a generated diff.",
    inputSchema: {
      rootPath: z.string().optional(),
      diffId: z.string()
    }
  },
  async ({ rootPath, diffId }) => {
    const root = resolveRoot(rootPath);
    const diff = await readDiff(root, diffId);
    return jsonResult({
      previewUrl: `file://${path.join(root, ".motion-mcp", "diffs", `${diffId}.json`)}`,
      snapshotImageBase64: "",
      summary: diff.summary,
      files: diff.files.map((file) => file.path)
    });
  }
);

server.registerTool(
  "export_animation",
  {
    title: "Export animation",
    description: "Export an asset's compiled SceneDoc as Lottie JSON or a self-contained animated SVG. Requires research_state_machine_experience to have run.",
    inputSchema: {
      rootPath: z.string().optional(),
      componentId: z.string(),
      format: z.enum(["animated-svg", "lottie"]).default("lottie"),
      state: z.string().optional().describe("State whose clip to bake. Defaults to the machine's initial state."),
      fps: z.number().optional()
    }
  },
  async ({ rootPath, componentId, format, state, fps }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 2, reason: `export_animation:${format}` });
    return jsonResult(await exportAnimation(root, { componentId, format, state, fps }));
  }
);

server.registerTool(
  "import_riv",
  {
    title: "Import .riv file",
    description: "Migration wedge from Rive: validates a .riv binary, extracts its content inventory (objects, names, type histogram) per the public format spec, indexes the asset, and stages a SceneDoc skeleton + full report under .motion-mcp/riv-imports/.",
    inputSchema: {
      rootPath: z.string().optional(),
      filePath: z.string().describe("Path to the .riv file, relative to the project root.")
    }
  },
  async ({ rootPath, filePath }) => {
    const root = resolveRoot(rootPath);
    return jsonResult(await importRivAsset(root, filePath));
  }
);

server.registerTool(
  "capture_gif",
  {
    title: "Capture GIF",
    description: "Render a SceneDoc state to an animated GIF (no browser — headless SVG rasterization via resvg). Requires research_state_machine_experience; installs @resvg/resvg-js on first use if missing.",
    inputSchema: {
      rootPath: z.string().optional(),
      componentId: z.string(),
      state: z.string().optional(),
      fps: z.number().optional().describe("Frames per second, 1-60. Default 20."),
      maxFrames: z.number().optional().describe("Safety cap. Default 120."),
      width: z.number().optional()
    }
  },
  async ({ rootPath, componentId, state, fps, maxFrames, width }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 5, reason: "capture_gif" });
    return jsonResult(await captureGifAsset(root, { componentId, state, fps, maxFrames, width }));
  }
);

server.registerTool(
  "capture_video",
  {
    title: "Capture video",
    description: "Render a SceneDoc state to MP4 (H.264) or WebM (VP9) via system ffmpeg on top of the same headless frame pipeline as capture_gif.",
    inputSchema: {
      rootPath: z.string().optional(),
      componentId: z.string(),
      format: z.enum(["mp4", "webm"]).default("mp4"),
      state: z.string().optional(),
      fps: z.number().optional(),
      maxFrames: z.number().optional(),
      width: z.number().optional()
    }
  },
  async ({ rootPath, componentId, format, state, fps, maxFrames, width }) => {
    const root = resolveRoot(rootPath);
    await consumeCredits(root, { amount: 5, reason: `capture_video:${format}` });
    return jsonResult(await captureVideoAsset(root, { componentId, format, state, fps, maxFrames, width }));
  }
);

server.registerTool(
  "get_credit_balance",
  {
    title: "Get credit balance",
    description: "Read the current Motion MCP credit balance.",
    inputSchema: RootSchema.shape
  },
  async ({ rootPath }) => {
    return jsonResult(await getCreditBalance(resolveRoot(rootPath)));
  }
);

server.registerTool(
  "purchase_credits_url",
  {
    title: "Purchase credits URL",
    description: "Return the checkout URL for buying more credits.",
    inputSchema: {}
  },
  async () => jsonResult(purchaseCreditsUrl())
);

server.registerTool(
  "generate_asset_batch",
  {
    title: "Generate asset batch",
    description: "Manifest-driven batch SVG generation. Premium items go through QuiverAI, simple items return host-agent briefs. Supports dryRun for a zero-cost estimate.",
    inputSchema: {
      rootPath: z.string().optional(),
      dryRun: z.boolean().default(false).describe("When true, estimate costs and lane decisions without generating or spending credits."),
      manifest: z.array(z.object({
        id: z.string().describe("Stable asset id used in reports and downstream wiring."),
        brief: z.string().describe("What the asset depicts and where it is used."),
        lane: z.enum(["premium", "simple"]).default("premium"),
        model: SvgModelSchema,
        stylePreset: z.string().optional().describe("Premium style preset id. One of: kids-storybook, soft-toy, flat-sticker, manipulative."),
        placement: AssetPlacementSchema
      })).min(1).max(64)
    }
  },
  async ({ rootPath, dryRun, manifest }) => {
    return jsonResult(await runAssetBatch(resolveRoot(rootPath), Boolean(dryRun), manifest));
  }
);

type AssetBatchItem = {
  id: string;
  brief: string;
  lane: "premium" | "simple";
  model?: SvgModelId;
  stylePreset?: StylePresetId;
  placement?: AssetPlacement;
};

async function runAssetBatch(root: string, dryRun: boolean, manifest: Array<Record<string, unknown>>): Promise<unknown> {
  const results: Array<Record<string, unknown>> = [];
  let estimatedQuiverCredits = 0;
  let committedQuiverCredits = 0;
  for (const raw of manifest) {
    const item = raw as unknown as AssetBatchItem;
    try {
      if (item.lane === "simple") {
        if (dryRun) {
          results.push({ id: item.id, lane: "simple", status: "dry-run", motionCredits: 12 });
        } else {
          const brief = await buildSimpleSvgBrief(root, {
            assetBrief: `[${item.id}] ${item.brief}`,
            placement: item.placement
          });
          results.push({
            id: item.id,
            lane: "simple",
            status: "brief-ready",
            svgPrompt: brief.svgPrompt,
            acceptanceChecklist: brief.acceptanceChecklist,
            nextTool: brief.nextTool
          });
        }
        continue;
      }
      const model = (item.model ?? selectSvgModel({ prompt: item.brief })) as SvgModelId;
      const estimate = await estimateMotionCost(root, "generate_svg_asset", undefined, model);
      if (dryRun) {
        results.push({
          id: item.id,
          lane: "premium",
          status: "dry-run",
          model,
          quiverPricingCredits: estimate.quiverPricingCredits,
          motionCredits: estimate.motionCredits
        });
        estimatedQuiverCredits += estimate.quiverPricingCredits ?? 0;
        continue;
      }
      const generated = await generatePremiumSvgAsset(root, {
        assetBrief: `${item.brief} The asset must read as a single composition named "${item.id}".`,
        placement: item.placement ?? { moment: item.id },
        model,
        stylePreset: item.stylePreset
      });
      results.push({
        id: item.id,
        lane: "premium",
        status: "generated",
        diffId: generated.diffId,
        assetId: generated.asset.id,
        previewUrl: generated.previewUrl,
        model: generated.model,
        quiverPricingCredits: generated.quiverPricingCredits
      });
      committedQuiverCredits += generated.quiverPricingCredits;
    } catch (error) {
      results.push({
        id: item.id,
        lane: (raw as { lane?: string }).lane ?? "premium",
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    rootPath: root,
    dryRun,
    requestedItems: manifest.length,
    generatedItems: results.filter((item) => item.status === "generated").length,
    failedItems: results.filter((item) => item.status === "failed").length,
    estimatedOrSpentQuiverCredits: dryRun ? estimatedQuiverCredits : committedQuiverCredits,
    results,
    nextTool: dryRun ? "generate_asset_batch" : "apply_motion_diff"
  };
}

async function estimateMotionCost(
  root: string,
  operation: MotionCostEstimate["operation"],
  planItemId?: string,
  model?: SvgModelId
): Promise<MotionCostEstimate> {
  if (operation === "generate_svg_asset" || operation === "generate_premium_svg_asset" || operation === "vectorize_asset") {
    const selectedModel = model ?? selectSvgModel({});
    const modelInfo = await quiver.getModel(selectedModel);
    return {
      operation,
      model: selectedModel,
      quiverPricingCredits: modelInfo.pricingCredits,
      motionCredits: motionCreditsForQuiver(modelInfo.pricingCredits),
      marginMultiplier: 2,
      planItemId,
      source: modelInfo ? "live-model-price" : "fallback-model-price"
    };
  }
  if (operation === "generate_animation" && planItemId) {
    const plan = await loadOptionalJson<MotionPlanResult>(root, "plan.json");
    const item = plan?.plan.find((candidate) => candidate.componentId === planItemId);
    if (item) {
      return {
        operation,
        motionCredits: item.estimatedCredits,
        marginMultiplier: 1,
        planItemId,
        source: "plan-estimate"
      };
    }
  }
  const fixedByOperation: Record<MotionOperation, number> = {
    scan_codebase: 5,
    scan_assets: 10,
    auto_research_motion: 25,
    research_app_motion: 30,
    research_state_machine_experience: 40,
    plan_screen_motion: 15,
    estimate_asset_lane: 3,
    ingest_svg_asset: 8,
    generate_simple_svg_asset: 12,
    generate_premium_svg_asset: 50,
    plan_microinteractions: 20,
    generate_animation: 90,
    generate_svg_asset: 50,
    vectorize_asset: 50,
    validate: 5
  };
  const fixed = fixedByOperation[operation] ?? 90;
  return {
    operation,
    motionCredits: fixed,
    marginMultiplier: 1,
    planItemId,
    source: "fixed-local-price"
  };
}

async function buildSimpleSvgBrief(
  root: string,
  input: {
    assetBrief: string;
    placement?: AssetPlacement;
  }
): Promise<SimpleSvgAssetBriefResult> {
  const context = await getAppMotionContext(root);
  const screenId = input.placement?.screenId ?? context.screens[0]?.screenId;
  const decision = screenId
    ? await estimateAssetLane({ rootPath: root, screenId, assetBrief: input.assetBrief })
    : fallbackSimpleLaneDecision(input.assetBrief);
  const placement = placementLabel(input.placement) || (screenId ? `screen:${screenId}` : undefined);
  return {
    lane: "simple",
    rootPath: root,
    assetBrief: input.assetBrief,
    placement,
    svgPrompt: strictSimpleSvgPrompt(input.assetBrief, placement, decision),
    acceptanceChecklist: decision.acceptanceChecklist,
    nextTool: "ingest_svg_asset"
  };
}

async function generatePremiumSvgAsset(
  root: string,
  input: {
    assetBrief: string;
    placement?: AssetPlacement;
    model?: SvgModelId;
    stylePreset?: StylePresetId;
  }
): Promise<GeneratedSvgAssetResult & {
  laneDecision: AssetLaneDecision;
  placement?: string;
  rigReport: ReturnType<typeof analyzeSvgRig>;
  nextTool: "generate_animation";
}> {
  const context = await getAppMotionContext(root);
  const screenId = input.placement?.screenId ?? context.screens[0]?.screenId;
  const laneDecision = screenId
    ? await estimateAssetLane({ rootPath: root, screenId, assetBrief: input.assetBrief })
    : fallbackPremiumLaneDecision(input.assetBrief);
  const placement = placementLabel(input.placement) || (screenId ? `screen:${screenId}` : undefined);
  const generated = await generateSvgAsset(root, {
    prompt: premiumSvgPrompt(input.assetBrief, placement, laneDecision, context.motionThesis.personality, input.stylePreset),
    instructions: premiumSvgInstructions(placement, input.stylePreset),
    references: [],
    model: input.model ?? laneDecision.recommendedModel,
    n: 1
  });
  let stagedSvg = "";
  try {
    stagedSvg = await fs.readFile(path.join(root, generated.asset.path), "utf8");
  } catch {
    stagedSvg = "";
  }
  return {
    ...generated,
    laneDecision,
    placement,
    rigReport: analyzeSvgRig(stagedSvg),
    nextTool: "generate_animation"
  };
}

async function ingestSvgAsset(
  root: string,
  input: {
    svg: string;
    source: AssetInfo["source"];
    placement?: AssetPlacement;
    prompt: string;
    creditAmount: number;
    creditReason: string;
  }
): Promise<{
  diffId: string;
  asset: AssetInfo;
  source: AssetInfo["source"];
  validation: ReturnType<typeof validateIngestableSvg>;
  rigReport: ReturnType<typeof analyzeSvgRig>;
  motionCreditsReserved: number;
  motionCreditsCommitted: number;
  reservationId: string;
  previewUrl: string;
  nextTool: "generate_animation";
}> {
  const validation = validateIngestableSvg(input.svg);
  if (!validation.ok) {
    throw new Error(`SVG rejected: ${validation.errors.join(" ")}`);
  }
  const rigReport = analyzeSvgRig(input.svg);
  const reservation = await reserveCredits(root, {
    amount: input.creditAmount,
    reason: input.creditReason,
    refId: placementLabel(input.placement)
  });
  try {
    const normalized = normalizeSvg(input.svg);
    const staged = await stageGeneratedSvg(root, {
      svg: normalized,
      source: input.source,
      prompt: input.prompt,
      instructions: `Ingested SVG with ${validation.animatableParts} named animatable parts${input.placement ? ` for ${placementLabel(input.placement)}` : ""}.`
    });
    await commitCreditReservation(root, reservation.reservationId, `commit ${input.creditReason}`);
    return {
      diffId: staged.diff.diffId,
      asset: staged.asset,
      source: input.source,
      validation,
      rigReport,
      motionCreditsReserved: reservation.amount,
      motionCreditsCommitted: reservation.amount,
      reservationId: reservation.reservationId,
      previewUrl: `file://${staged.previewPath}`,
      nextTool: "generate_animation"
    };
  } catch (error) {
    await refundCreditReservation(root, reservation.reservationId, `refund failed SVG ingestion: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function fallbackSimpleLaneDecision(assetBrief: string): AssetLaneDecision {
  return {
    lane: "simple",
    confidence: 0.66,
    reason: "No screen context was available, so Motion MCP defaults to the low-cost host-model lane.",
    estimatedCredits: 12,
    complexity: "medium",
    svgBrief: `${assetBrief} Include semantic ids, a valid viewBox, and compact animatable groups.`,
    acceptanceChecklist: [
      "SVG includes a valid viewBox.",
      "At least three animatable parts have stable id or data-name attributes.",
      "No raster image dependency is embedded in the SVG.",
      "Parts are named by role, such as primary-shape, accent-spark, progress-ring, or success-check.",
      "Composition stays compact and readable for model-generated SVG."
    ]
  };
}

function fallbackPremiumLaneDecision(assetBrief: string): AssetLaneDecision {
  return {
    lane: "premium",
    confidence: 0.72,
    reason: "No screen context was available, but the caller requested premium generation, so QuiverAI is selected.",
    estimatedCredits: 50,
    recommendedModel: selectSvgModel({ prompt: assetBrief }),
    complexity: /dense|technical|diagram|detailed|high[- ]?fidelity/i.test(assetBrief) ? "high" : "medium",
    svgBrief: `${assetBrief} Create a layered production SVG with named parts for state-machine animation.`,
    acceptanceChecklist: [
      "SVG includes a valid viewBox.",
      "At least three animatable parts have stable id or data-name attributes.",
      "No raster image dependency is embedded in the SVG.",
      "Parts are named by role, such as logo-mark, spark-core, progress-ring, success-check, or error-shake.",
      "Composition has enough detail to justify QuiverAI credits."
    ]
  };
}

function strictSimpleSvgPrompt(
  assetBrief: string,
  placement: string | undefined,
  decision: AssetLaneDecision
): string {
  return [
    "Generate one compact, animatable SVG for Motion MCP's simple lane.",
    "Return only raw SVG markup. Do not wrap it in Markdown.",
    `Asset brief: ${assetBrief}`,
    placement ? `Placement: ${placement}` : "Placement: infer from the brief.",
    `Lane decision: ${decision.reason}`,
    "Required structure:",
    "- Include xmlns and a valid viewBox on the root <svg>.",
    "- Use 3 to 8 named animatable parts with stable id or data-name attributes.",
    "- Prefer <g>, <path>, <circle>, <rect>, <line>, <polyline>, <polygon>, and <text>.",
    "- Name parts by role, for example primary-shape, accent-spark, progress-ring, success-check, error-shake, or press-shadow.",
    "- Do not include <script>, event handlers, external links, embedded raster images, or base64 image data.",
    "- Keep geometry simple enough for a coding model to understand and modify.",
    "Acceptance checklist:",
    ...decision.acceptanceChecklist.map((item) => `- ${item}`),
    "After generating it, call ingest_svg_asset with the SVG."
  ].join("\n");
}

function premiumSvgPrompt(
  assetBrief: string,
  placement: string | undefined,
  decision: AssetLaneDecision,
  personality: string[],
  stylePreset?: StylePresetId
): string {
  const preset = stylePreset ? STYLE_PRESETS[stylePreset] : undefined;
  return [
    assetBrief,
    placement ? `Placement: ${placement}.` : "Placement: selected app screen.",
    `Motion personality: ${personality.slice(0, 4).join(", ") || "premium, clear, responsive"}.`,
    preset ? `Style preset (${stylePreset}): ${preset.prompt}` : "",
    `Lane reason: ${decision.reason}`,
    "Create a structured, layered SVG asset for Rive-like host-code animation.",
    "The asset must have semantic ids for each animatable group/path and enough part separation for idle, hover, pressed, active, success, error, and disabled states.",
    "Avoid raster embeds, scripts, external links, and monolithic single-path illustrations."
  ].filter(Boolean).join(" ");
}

type StylePresetId = keyof typeof STYLE_PRESET_DEFINITIONS;

const STYLE_PRESET_DEFINITIONS = {
  "kids-storybook": {
    prompt: "Warm children's storybook illustration: soft rounded shapes, friendly proportions (large heads, big eyes), gentle saturated colors, no sharp edges, no text, no letters, no numbers rendered as glyphs. Ages 3-12 safe: nothing scary, nothing uncanny."
  },
  "soft-toy": {
    prompt: "Plush toy look: fuzzy-soft silhouette, subtle fabric texture suggestion via layered paths, button-like eyes kept friendly, pastel palette with one warm accent. No hard shadows."
  },
  "flat-sticker": {
    prompt: "Flat sticker style: bold clean silhouettes, uniform stroke weight, bright two-to-four color palette per part, white or transparent gap between overlapping parts like a die-cut sticker. No gradients unless asked."
  },
  "manipulative": {
    prompt: "Educational manipulative clarity: each interactive piece visually distinct with high color contrast between parts, chunky geometry readable at small sizes, unambiguous affordance for pressing, sliding, or counting. Used while a child is learning, so no decorative noise."
  }
} as const;

const STYLE_PRESETS = STYLE_PRESET_DEFINITIONS;

function premiumSvgInstructions(
  placement: string | undefined,
  stylePreset?: StylePresetId
): string {
  const preset = stylePreset ? STYLE_PRESETS[stylePreset] : undefined;
  return [
    "Use a valid viewBox and semantic ids on every animatable group/path.",
    "Create distinct primary, accent, shadow, highlight, feedback, and state-specific parts when relevant.",
    "Favor clean part boundaries that can bind to app state properties like isLoading, progress, count, isSelected, hasError, themeColor, avatarImage, and rewardLevel.",
    "Name character parts by role so rigs can bind them: eyes (both pupils share one group), head-or-body, mouth-or-beak, limb-or-wing, tail-or-tuft, shadow, sparkle.",
    preset ? `Style constraints: ${preset.prompt}` : "",
    "Keep the SVG self-contained and framework-neutral.",
    placement ? `Optimize the composition for ${placement}.` : "Optimize the composition for the selected app placement."
  ].filter(Boolean).join(" ");
}

/** Character/object rig roles we can bind state machines to, in binding priority order. */
const RIG_PART_ROLES: Array<{ role: string; pattern: RegExp; binds: string }> = [
  { role: "eyes", pattern: /(^|[^a-z])(eyes?|pupil|iris|gaze)([^a-z]|$)/i, binds: "eye-follow (pointer tracking), blink (scaleY)" },
  { role: "head/body", pattern: /(^|[^a-z])(head|face|body|torso|base|core)([^a-z]|$)/i, binds: "tilt, bob, press-depress" },
  { role: "mouth/beak", pattern: /(^|[^a-z])(mouth|beak|smile|lips?)([^a-z]|$)/i, binds: "speech acknowledgement (scale 1.06)" },
  { role: "limb/wing", pattern: /(^|[^a-z])(arm|hand|leg|foot|wing|fin)([^a-z]|$)/i, binds: "wave, point-at-hint" },
  { role: "tail/tuft", pattern: /(^|[^a-z])(tail|tuft|ears?|antenna)([^a-z]|$)/i, binds: "greeting lift (rotate ≤2.5°)" },
  { role: "shadow", pattern: /(shadow|shade)/i, binds: "grounding scale on hover/press" },
  { role: "sparkle", pattern: /(spark|star|shine|glow|flare|magic)/i, binds: "success accent, reward pulse" }
];

/**
 * Reports which riggable roles an SVG exposes so host code knows which
 * Rive-like states the asset can support before animation code is generated.
 */
export function analyzeSvgRig(svg: string): {
  ok: boolean;
  foundRoles: Array<{ role: string; nodeId: string; suggestedBindings: string }>;
  missingRoles: string[];
  animatableParts: number;
  notes: string[];
} {
  if (!svg) {
    return { ok: false, foundRoles: [], missingRoles: RIG_PART_ROLES.map((role) => role.role), animatableParts: 0, notes: ["No SVG source was available for rig analysis."] };
  }
  const nodes = parseSvgTree(svg).flatMap(flattenSvgNodes);
  const named = nodes.filter((node) => Boolean(node.id || node.attrs["data-name"] || node.className));
  const foundRoles: Array<{ role: string; nodeId: string; suggestedBindings: string }> = [];
  const missingRoles: string[] = [];
  for (const candidate of RIG_PART_ROLES) {
    const match = named.find((node) => {
      const label = `${node.id ?? ""} ${node.attrs["data-name"] ?? ""} ${node.className ?? ""}`;
      return candidate.pattern.test(label);
    });
    if (match) {
      foundRoles.push({
        role: candidate.role,
        nodeId: match.id ?? match.attrs["data-name"] ?? match.nodeId,
        suggestedBindings: candidate.binds
      });
    } else {
      missingRoles.push(candidate.role);
    }
  }
  const hasEyes = foundRoles.some((role) => role.role === "eyes");
  const notes: string[] = [];
  if (!hasEyes && /character|mascot|creature|animal|bird|face/i.test(svg.slice(0, 2000))) {
    notes.push("Looks like a character but no eyes part was detected — add a group with id containing 'eyes' for eye-follow interaction.");
  }
  if (named.length < 3) {
    notes.push("Fewer than three named parts; most state machines need at least three.");
  }
  return {
    ok: foundRoles.length >= 2,
    foundRoles,
    missingRoles,
    animatableParts: named.length,
    notes
  };
}

function validateIngestableSvg(svg: string): {
  ok: boolean;
  errors: string[];
  animatableParts: number;
  viewBox?: string;
} {
  const errors: string[] = [];
  if (!/<svg\b/i.test(svg)) {
    errors.push("Expected a root <svg> element.");
  }
  if (/<script\b|on[a-z]+\s*=|javascript:/i.test(svg)) {
    errors.push("Scripts, inline event handlers, and javascript: URLs are not allowed.");
  }
  if (/<image\b|(?:href|xlink:href)\s*=\s*["']data:image/i.test(svg)) {
    errors.push("Embedded raster images are not allowed in animatable SVG assets.");
  }
  const dimensions = parseSvgDimensions(svg);
  if (!dimensions?.viewBox) {
    errors.push("SVG must include a valid viewBox.");
  }
  const animatableParts = parseSvgTree(svg)
    .flatMap(flattenSvgNodes)
    .filter((node) => !["svg", "defs", "linearGradient", "radialGradient"].includes(node.tag))
    .filter((node) => Boolean(node.id || node.attrs["data-name"] || node.className))
    .length;
  if (animatableParts < 3) {
    errors.push("SVG must include at least three named animatable parts with id, class, or data-name attributes.");
  }
  return {
    ok: errors.length === 0,
    errors,
    animatableParts,
    viewBox: dimensions?.viewBox
  };
}

function normalizeSvg(svg: string): string {
  const trimmed = svg.trim();
  if (/^<svg\b[^>]*\sxmlns=/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function placementLabel(placement?: AssetPlacement): string | undefined {
  if (!placement) return undefined;
  return [
    placement.screenId ? `screen:${placement.screenId}` : undefined,
    placement.flowId ? `flow:${placement.flowId}` : undefined,
    placement.componentId ? `component:${placement.componentId}` : undefined,
    placement.file ? `file:${placement.file}` : undefined,
    placement.moment ? `moment:${placement.moment}` : undefined
  ].filter(Boolean).join(" | ") || undefined;
}

async function generateSvgAsset(
  root: string,
  input: {
    prompt: string;
    instructions?: string;
    references?: string[];
    model?: SvgModelId;
    n?: number;
  }
): Promise<GeneratedSvgAssetResult> {
  const selectedModel = selectSvgModel({
    requested: input.model,
    prompt: input.prompt,
    instructions: input.instructions
  });
  const estimate = await estimateMotionCost(root, "generate_svg_asset", undefined, selectedModel);
  const reservation = await reserveCredits(root, {
    amount: estimate.motionCredits,
    reason: `generate_svg_asset:${selectedModel}`
  });
  try {
    const result = await quiver.generateSvg({
      prompt: input.prompt,
      instructions: input.instructions,
      references: input.references,
      model: selectedModel,
      n: input.n
    });
    const staged = await stageGeneratedSvg(root, {
      svg: result.svg,
      source: "quiver",
      prompt: input.prompt,
      instructions: input.instructions
    });
    await commitCreditReservation(root, reservation.reservationId, "commit quiver svg generation");
    await recordQuiverUsage(root, {
      id: stableId("quiver_usage", `${reservation.reservationId}:${nowIso()}`),
      operation: "generate_svg_asset",
      model: result.model,
      quiverPricingCredits: result.pricingCredits,
      motionCreditsReserved: reservation.amount,
      motionCreditsCommitted: reservation.amount,
      requestId: result.requestId,
      traceId: result.traceId,
      rateLimit: result.rateLimit,
      createdAt: nowIso()
    });
    return {
      diffId: staged.diff.diffId,
      asset: staged.asset,
      model: result.model,
      quiverPricingCredits: result.pricingCredits,
      motionCreditsReserved: reservation.amount,
      motionCreditsCommitted: reservation.amount,
      reservationId: reservation.reservationId,
      requestId: result.requestId,
      previewUrl: `file://${staged.previewPath}`
    };
  } catch (error) {
    await refundCreditReservation(root, reservation.reservationId, `refund failed Quiver SVG generation: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function vectorizeAsset(
  root: string,
  input: {
    imagePath: string;
    instructions?: string;
    model?: SvgModelId;
  }
): Promise<GeneratedSvgAssetResult> {
  const absoluteImage = path.join(root, input.imagePath);
  const image = await fs.readFile(absoluteImage);
  const mimeType = mimeTypeForPath(input.imagePath);
  const selectedModel = selectSvgModel({
    requested: input.model,
    instructions: input.instructions
  });
  const estimate = await estimateMotionCost(root, "vectorize_asset", undefined, selectedModel);
  const reservation = await reserveCredits(root, {
    amount: estimate.motionCredits,
    reason: `vectorize_asset:${selectedModel}`,
    refId: input.imagePath
  });
  try {
    const result = await quiver.vectorizeAsset({
      imageBase64: image.toString("base64"),
      mimeType,
      instructions: input.instructions,
      model: selectedModel
    });
    const staged = await stageGeneratedSvg(root, {
      svg: result.svg,
      source: "vectorized",
      prompt: `Vectorized ${input.imagePath}`,
      instructions: input.instructions
    });
    await commitCreditReservation(root, reservation.reservationId, "commit quiver vectorization");
    await recordQuiverUsage(root, {
      id: stableId("quiver_usage", `${reservation.reservationId}:${nowIso()}`),
      operation: "vectorize_asset",
      model: result.model,
      quiverPricingCredits: result.pricingCredits,
      motionCreditsReserved: reservation.amount,
      motionCreditsCommitted: reservation.amount,
      requestId: result.requestId,
      traceId: result.traceId,
      rateLimit: result.rateLimit,
      createdAt: nowIso()
    });
    return {
      diffId: staged.diff.diffId,
      asset: staged.asset,
      model: result.model,
      quiverPricingCredits: result.pricingCredits,
      motionCreditsReserved: reservation.amount,
      motionCreditsCommitted: reservation.amount,
      reservationId: reservation.reservationId,
      requestId: result.requestId,
      previewUrl: `file://${staged.previewPath}`
    };
  } catch (error) {
    await refundCreditReservation(root, reservation.reservationId, `refund failed Quiver vectorization: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function stageGeneratedSvg(
  root: string,
  input: {
    svg: string;
    source: AssetInfo["source"];
    prompt: string;
    instructions?: string;
  }
): Promise<{ asset: AssetInfo; diff: GeneratedMotionDiff; previewPath: string }> {
  const filename = `${slugify(input.prompt)}-${stableId("svg", `${input.prompt}:${nowIso()}`).slice(-6)}.svg`;
  const relativePath = `.motion-mcp/generated-assets/${filename}`;
  const asset = assetFromSvg(root, relativePath, input.svg, input.source);
  await upsertIndexedAsset(root, asset);
  const diffId = stableId("diff", `svg:${relativePath}:${nowIso()}`);
  const diff: GeneratedMotionDiff = {
    diffId,
    rootPath: root,
    componentId: asset.id,
    summary: `Generated SVG asset ${relativePath}${input.instructions ? `: ${input.instructions}` : ""}`,
    framework: "unknown",
    creditsConsumed: 0,
    validationStatus: {
      ok: true,
      skipped: true,
      reason: "Generated SVG asset is staged; validation runs after apply_motion_diff."
    },
    files: [
      {
        path: relativePath,
        mode: "create",
        content: `${input.svg.trim()}\n`
      }
    ],
    unifiedDiff: toUnifiedDiff([
      {
        path: relativePath,
        mode: "create",
        content: `${input.svg.trim()}\n`
      }
    ]),
    createdAt: nowIso()
  };
  const previewPath = path.join(root, ".motion-mcp", "previews", `${diffId}.svg`);
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(previewPath, `${input.svg.trim()}\n`, "utf8");
  await writeDiff(root, diff);
  return { asset, diff, previewPath };
}

async function generateAnimation(
  root: string,
  componentId: string,
  options: GenerateAnimationOptions
): Promise<GeneratedMotionDiff> {
  const plan = await loadOptionalJson<MotionPlanResult>(root, "plan.json");
  const assets = await loadOptionalJson<AssetIndexResult>(root, "assets.json");
  const asset = assets?.assets.find((candidate) => candidate.id === componentId);
  const planItem = plan?.plan.find((item) => item.componentId === componentId) ?? (asset
    ? {
        componentId: asset.id,
        assetId: asset.id,
        file: asset.path,
        framework: options.framework ?? "next" as const,
        runtime: ["framer-motion", "gsap"] as const,
        interactionIdea: `Animate ${asset.path} with a Rive-like generated host-code state machine.`,
        whyItMatters: "Generated SVG assets should become interactive immediately after creation.",
        suggestedTrigger: options.trigger ?? "hover" as const,
        premiumScore: 88,
        estimatedCredits: 90,
        complexity: "medium" as const
      }
    : undefined);
  if (!planItem) {
    throw new Error(`No plan item or indexed asset found for componentId ${componentId}. Run plan_microinteractions or generate_svg_asset first.`);
  }

  const credits = planItem.estimatedCredits;
  await consumeCredits(root, {
    amount: credits,
    reason: `generate_animation:${componentId}`,
    refId: plan?.planId
  });

  const framework = options.framework ?? planItem.framework;
  const targetAsset = asset ?? assets?.assets.find((candidate) => candidate.id === planItem.assetId);
  const sceneArtboard = await sceneForPlanItem(root, planItem, componentId);
  let files = emitForFramework(framework, {
    planItem: { ...planItem, framework },
    asset: targetAsset,
    options,
    scene: sceneArtboard
  });
  let patchNotes: string[] = [];
  if (options.patchIntoSource && ["react", "next", "unknown"].includes(framework)) {
    try {
      files = await stageImportPatch(root, planItem.file, componentNameFromFiles(files), files);
      patchNotes = ["AST import patch staged into source file"];
    } catch (error) {
      patchNotes = [`AST patch skipped: ${error instanceof Error ? error.message : String(error)}`];
    }
  }
  const diffId = stableId("diff", `${componentId}:${nowIso()}`);
  const diff: GeneratedMotionDiff = {
    diffId,
    rootPath: root,
    componentId,
    summary: `Generated ${framework} motion for ${planItem.file}: ${planItem.interactionIdea}${sceneArtboard ? ` (scene: ${sceneArtboard.artboardId}, ${Object.keys(sceneArtboard.clips).length} clips)` : ""}${patchNotes.length > 0 ? ` [${patchNotes.join("; ")}]` : ""}`,
    framework,
    creditsConsumed: credits,
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
  return diff;
}

interface ExportAnimationParams {
  componentId: string;
  format: "animated-svg" | "lottie";
  state?: string;
  fps?: number;
}

/** Shared loader: indexed SVG asset → SceneDoc artboard with sourceSvg attached. */
async function loadSceneForAsset(
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

/**
 * Exports the compiled SceneDoc for an asset as portable artifacts:
 * Lottie JSON or a self-contained animated SVG.
 */
async function exportAnimation(
  root: string,
  params: ExportAnimationParams
): Promise<{ exportPath: string; format: string; bytes: number }> {
  const { doc, base } = await loadSceneForAsset(root, params.componentId);
  const suffix = params.state ? `.${slugify(params.state)}` : "";
  const dir = path.join(root, ".motion-mcp", "exports");
  await fs.mkdir(dir, { recursive: true });

  if (params.format === "animated-svg") {
    const output = toAnimatedSvg(doc, { state: params.state });
    const file = path.join(dir, `${base}${suffix}.svg`);
    await fs.writeFile(file, output, "utf8");
    return { exportPath: path.relative(root, file), format: "animated-svg", bytes: Buffer.byteLength(output, "utf8") };
  }

  const json = `${JSON.stringify(toLottie(doc, { state: params.state, fps: params.fps }), null, 2)}\n`;
  const file = path.join(dir, `${base}${suffix}.lottie.json`);
  await fs.writeFile(file, json, "utf8");
  return { exportPath: path.relative(root, file), format: "lottie", bytes: Buffer.byteLength(json, "utf8") };
}

interface CaptureGifParams {
  componentId: string;
  state?: string;
  fps?: number;
  maxFrames?: number;
  width?: number;
}

/** Renders a SceneDoc state to an animated GIF via headless SVG rasterization. */
async function captureGifAsset(
  root: string,
  params: CaptureGifParams
): Promise<{ exportPath: string; frames: number; width: number; height: number; bytes: number }> {
  const { doc, base } = await loadSceneForAsset(root, params.componentId);
  const result = await captureSceneGif(doc, {
    state: params.state,
    fps: params.fps,
    maxFrames: params.maxFrames,
    width: params.width
  });
  const suffix = params.state ? `.${slugify(params.state)}` : "";
  const dir = path.join(root, ".motion-mcp", "exports");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${base}${suffix}.gif`);
  await fs.writeFile(file, result.gif);
  return {
    exportPath: path.relative(root, file),
    frames: result.frames,
    width: result.width,
    height: result.height,
    bytes: result.gif.byteLength
  };
}

interface CaptureVideoParams extends CaptureGifParams {
  format: "mp4" | "webm";
}

/** Renders a SceneDoc state to MP4 (H.264) or WebM (VP9) via system ffmpeg. */
async function captureVideoAsset(
  root: string,
  params: CaptureVideoParams
): Promise<{ exportPath: string; frames: number; format: string; bytes: number }> {
  const { doc, base } = await loadSceneForAsset(root, params.componentId);
  const { frames, fps } = await renderSceneFrames(doc, {
    state: params.state,
    fps: params.fps,
    maxFrames: params.maxFrames,
    width: params.width
  });
  const video = await assembleVideo({
    frames: frames.map((frame) => frame.png),
    fps,
    format: params.format
  });
  const suffix = params.state ? `.${slugify(params.state)}` : "";
  const dir = path.join(root, ".motion-mcp", "exports");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${base}${suffix}.${params.format}`);
  await fs.writeFile(file, video);
  return {
    exportPath: path.relative(root, file),
    frames: frames.length,
    format: params.format,
    bytes: video.byteLength
  };
}

/**
 * Imports a .riv file: validates the Rive binary format, extracts a full
 * content inventory, indexes the asset, and stages a SceneDoc skeleton.
 * The migration wedge for teams moving off Rive.
 */
async function importRivAsset(
  root: string,
  filePath: string
): Promise<{
  ok: boolean;
  assetId?: string;
  header?: { majorVersion: number; minorVersion: number; fileId: number };
  objectCount: number;
  typeHistogram: Record<string, number>;
  discoveredNames: string[];
  warnings: string[];
  reportPath: string;
  sceneId?: string;
}> {
  const absolute = path.resolve(root, filePath);
  const buffer = await fs.readFile(absolute);
  const result = importRiv(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  const base = path.basename(filePath, path.extname(filePath));

  const reportDir = path.join(root, ".motion-mcp", "riv-imports");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${base}.json`);
  const skeleton = toSceneSkeleton(result, base);
  await fs.writeFile(reportPath, `${JSON.stringify({ result, skeleton }, null, 2)}\n`, "utf8");

  if (result.header) {
    const relativePath = path.relative(root, absolute).split(path.sep).join("/");
    await upsertIndexedAsset(root, {
      id: stableId("asset", relativePath),
      path: relativePath,
      type: "rive",
      semanticLabels: Array.from(new Set(result.strings.map((hit) => hit.value))).slice(0, 12),
      sizeBytes: buffer.byteLength
    });
  }

  return {
    ok: result.ok,
    assetId: result.header ? stableId("asset", filePath) : undefined,
    header: result.header,
    objectCount: result.objects.length,
    typeHistogram: result.typeHistogram,
    discoveredNames: Array.from(new Set(result.strings.map((hit) => hit.value))).slice(0, 12),
    warnings: result.warnings,
    reportPath: path.relative(root, reportPath),
    sceneId: result.ok ? skeleton.sceneId : undefined
  };
}

function componentNameFromFiles(files: FileChange[]): string {  const generated = files.find((file) => file.path.includes(".motion-mcp/generated/"));
  if (!generated) throw new Error("no generated component file found");
  return path.basename(generated.path, path.extname(generated.path));
}

async function stageImportPatch(
  root: string,
  sourceRelativePath: string,
  componentName: string,
  files: FileChange[]
): Promise<FileChange[]> {
  const generated = files.find((file) => file.path.includes(".motion-mcp/generated/"));
  if (!generated) return files;
  const sourceAbsolute = path.join(root, sourceRelativePath);
  const original = await fs.readFile(sourceAbsolute, "utf8");
  const sourceDir = path.dirname(sourceAbsolute);
  const specifier = toImportSpecifier(sourceDir, path.join(root, path.dirname(generated.path), path.basename(generated.path)));
  const { ensureImport } = await import("@motion-mcp/ast-patcher");
  const patched = ensureImport(original, specifier, [componentName]);
  if (!patched.changed) {
    return files;
  }
  return [
    ...files,
    {
      path: sourceRelativePath,
      mode: "replace",
      content: patched.content
    }
  ];
}

function toImportSpecifier(fromDir: string, targetFile: string): string {
  const withoutExt = targetFile.replace(/\.tsx?$/, "");
  let rel = path.relative(fromDir, withoutExt).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/**
 * Closes the spec-to-code disconnect: if a page state-machine experience
 * exists for this component, compile it into a SceneDoc artboard so emitters
 * render real states/transitions/clips instead of the fixed template.
 */async function sceneForPlanItem(
  root: string,
  planItem: MotionPlanResult["plan"][number],
  componentId: string
): Promise<ReturnType<typeof compileExperienceToScene> | undefined> {
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
    void componentId;
    return compileExperienceToScene(page satisfies PageStateMachineExperience);
  } catch {
    return undefined;
  }
}

function emitForFramework(
  framework: FrameworkKind,
  input: Parameters<typeof emitReactAnimation>[0]
): FileChange[] {
  if (framework === "next" || framework === "react" || framework === "unknown") {
    return emitReactAnimation(input);
  }
  if (framework === "react-native" || framework === "expo") {
    return emitReactNativeAnimation(input);
  }
  if (framework === "flutter") {
    return emitFlutterAnimation(input);
  }
  if (framework === "unity") {
    return emitUnityAnimation(input);
  }
  return emitReactAnimation(input);
}

async function applyMotionDiff(root: string, diffId: string): Promise<{
  success: boolean;
  filesChanged: string[];
  validationStatus: GeneratedMotionDiff["validationStatus"];
}> {
  const diff = await readDiff(root, diffId);
  const changed: string[] = [];
  for (const file of diff.files) {
    const target = path.join(root, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (file.mode === "append") {
      await fs.appendFile(target, file.content, "utf8");
    } else {
      await fs.writeFile(target, file.content, "utf8");
    }
    changed.push(file.path);
  }
  const validationStatus = await validateProject(root, diff.framework);
  const updated: GeneratedMotionDiff = {
    ...diff,
    validationStatus
  };
  await writeDiff(root, updated);
  return {
    success: validationStatus.ok,
    filesChanged: changed,
    validationStatus
  };
}

async function readDiff(root: string, diffId: string): Promise<GeneratedMotionDiff> {
  const file = path.join(root, ".motion-mcp", "diffs", `${diffId}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as GeneratedMotionDiff;
  } catch {
    throw new Error(`Diff ${diffId} was not found. Run generate_animation first.`);
  }
}

async function writeDiff(root: string, diff: GeneratedMotionDiff): Promise<void> {
  const dir = path.join(root, ".motion-mcp", "diffs");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${diff.diffId}.json`), `${JSON.stringify(diff, null, 2)}\n`, "utf8");
}

async function loadRequiredJson<T>(root: string, filename: string, help: string): Promise<T> {
  const loaded = await loadOptionalJson<T>(root, filename);
  if (!loaded) {
    throw new Error(`${filename} not found. ${help}`);
  }
  return loaded;
}

async function loadOptionalJson<T>(root: string, filename: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, ".motion-mcp", filename), "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function upsertIndexedAsset(root: string, asset: AssetInfo): Promise<void> {
  const existing = await loadOptionalJson<AssetIndexResult>(root, "assets.json");
  const assets = existing?.assets.filter((candidate) => candidate.id !== asset.id) ?? [];
  assets.push(asset);
  const result: AssetIndexResult = {
    rootPath: root,
    assets,
    indexPath: path.join(root, ".motion-mcp", "assets.json"),
    scannedAt: nowIso(),
    warnings: existing?.warnings ?? []
  };
  await fs.mkdir(path.join(root, ".motion-mcp"), { recursive: true });
  await fs.writeFile(path.join(root, ".motion-mcp", "assets.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function recordQuiverUsage(root: string, usage: QuiverUsageRecord): Promise<void> {
  const file = path.join(root, ".motion-mcp", "quiver-usage.json");
  const existing = await readJsonFile<QuiverUsageRecord[]>(file) ?? [];
  existing.push(usage);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function assetFromSvg(
  root: string,
  relativePath: string,
  svg: string,
  source: AssetInfo["source"]
): AssetInfo {
  const pathTree = parseSvgTree(svg);
  const semanticLabels = unique(pathTree.flatMap(flattenSvgNodes).map((node) => node.semanticLabel ?? node.roleGuess));
  return {
    id: stableId("asset", relativePath),
    path: relativePath,
    type: "svg",
    source,
    dimensions: parseSvgDimensions(svg),
    pathTree,
    semanticLabels,
    sizeBytes: Buffer.byteLength(svg, "utf8")
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "motion-asset";
}

function mimeTypeForPath(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function resolveRoot(rootPath?: string): string {
  return path.resolve(rootPath ?? process.env.MOTION_MCP_ROOT ?? process.cwd());
}

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function toUnifiedDiff(files: FileChange[]): string {
  return files
    .map((file) => {
      const body = file.content
        .split(/\r?\n/)
        .map((line) => `+${line}`)
        .join("\n");
      return `--- /dev/null\n+++ b/${file.path}\n@@\n${body}`;
    })
    .join("\n");
}

async function startHttpBridge(): Promise<void> {
  const port = Number.parseInt(process.env.MOTION_MCP_HTTP_PORT ?? "", 10);
  if (!port) return;
  const handlers: Record<string, (payload: any) => Promise<unknown>> = {
    scan_codebase: ({ rootPath }) => scanCodebase(resolveRoot(rootPath)),
    scan_assets: ({ rootPath }) => scanAssets(resolveRoot(rootPath)),
    feed_concept: ({ rootPath, logoSvgPath, brandConcept, brandPersonality }) =>
      feedConcept({
        rootPath: resolveRoot(rootPath),
        logoSvgPath,
        brandConcept,
        brandPersonality: brandPersonality ?? []
      }),
    plan_microinteractions: ({ rootPath, brief, focusArea }) =>
      planMicrointeractions({ rootPath: resolveRoot(rootPath), brief, focusArea }),
    auto_research_motion: async ({ rootPath, brief, focusPlatforms, includeSources }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 25, reason: "auto_research_motion" });
      return autoResearchMotion({
        rootPath: root,
        brief,
        focusPlatforms,
        includeSources
      });
    },
    research_app_motion: async ({ rootPath, brief }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 30, reason: "research_app_motion" });
      return researchAppMotion({ rootPath: root, brief });
    },
    research_state_machine_experience: async ({ rootPath, brief }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 40, reason: "research_state_machine_experience" });
      return researchStateMachineExperience({ rootPath: root, brief });
    },
    get_app_motion_context: ({ rootPath }) => getAppMotionContext(resolveRoot(rootPath)),
    generate_asset_batch: async ({ rootPath, dryRun, manifest }) =>
      runAssetBatch(resolveRoot(rootPath), Boolean(dryRun), manifest ?? []),
    plan_screen_motion: async ({ rootPath, screenId, flowId }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 15, reason: "plan_screen_motion" });
      return planScreenMotion({ rootPath: root, screenId, flowId });
    },
    estimate_asset_lane: async ({ rootPath, screenId, assetBrief }) => {
      const root = resolveRoot(rootPath);
      await consumeCredits(root, { amount: 3, reason: "estimate_asset_lane" });
      return estimateAssetLane({ rootPath: root, screenId, assetBrief });
    },
    generate_simple_svg_asset: async ({ rootPath, assetBrief, placement, svg }) => {
      const root = resolveRoot(rootPath);
      if (!svg) {
        await consumeCredits(root, { amount: 3, reason: "generate_simple_svg_asset:brief" });
        return buildSimpleSvgBrief(root, { assetBrief, placement });
      }
      return ingestSvgAsset(root, {
        svg,
        source: "generated",
        placement,
        prompt: assetBrief,
        creditAmount: 12,
        creditReason: "generate_simple_svg_asset:ingest"
      });
    },
    generate_premium_svg_asset: ({ rootPath, assetBrief, placement, model }) =>
      generatePremiumSvgAsset(resolveRoot(rootPath), {
        assetBrief,
        placement,
        model
      }),
    ingest_svg_asset: ({ rootPath, svg, source, placement }) =>
      ingestSvgAsset(resolveRoot(rootPath), {
        svg,
        source: source === "quiver" || source === "vectorized" ? source : "generated",
        placement,
        prompt: placementLabel(placement) || "ingested svg asset",
        creditAmount: 8,
        creditReason: "ingest_svg_asset"
      }),
    list_svg_models: async () => quiver.listModels(),
    estimate_motion_cost: ({ rootPath, operation, planItemId, model }) =>
      estimateMotionCost(resolveRoot(rootPath), operation, planItemId, model),
    generate_svg_asset: ({ rootPath, prompt, instructions, references, model, n }) =>
      generateSvgAsset(resolveRoot(rootPath), {
        prompt,
        instructions,
        references: references ?? [],
        model,
        n
      }),
    vectorize_asset: ({ rootPath, imagePath, instructions, model }) =>
      vectorizeAsset(resolveRoot(rootPath), {
        imagePath,
        instructions,
        model
      }),
    generate_animation: ({ rootPath, componentId, options }) =>
      generateAnimation(resolveRoot(rootPath), componentId, options ?? {}),
    export_animation: ({ rootPath, componentId, format, state, fps }) =>
      exportAnimation(resolveRoot(rootPath), { componentId, format, state, fps }),
    import_riv: ({ rootPath, filePath }) => importRivAsset(resolveRoot(rootPath), filePath),
    capture_gif: ({ rootPath, componentId, state, fps, maxFrames, width }) =>
      captureGifAsset(resolveRoot(rootPath), { componentId, state, fps, maxFrames, width }),
    capture_video: ({ rootPath, componentId, format, state, fps, maxFrames, width }) =>
      captureVideoAsset(resolveRoot(rootPath), { componentId, format, state, fps, maxFrames, width }),
    apply_motion_diff: ({ rootPath, diffId }) => applyMotionDiff(resolveRoot(rootPath), diffId),
    preview_animation: async ({ rootPath, diffId }) => {
      const root = resolveRoot(rootPath);
      const diff = await readDiff(root, diffId);
      let snapshotImageBase64 = "";
      try {
        // Real visual preview: render the diff's compiled scene deterministically.
        const { doc } = await loadSceneForAsset(root, diff.componentId);
        const { frames } = await renderSceneFrames(doc, { maxFrames: 1 });
        if (frames.length > 0) {
          snapshotImageBase64 = Buffer.from(frames[0]!.png).toString("base64");
        }
      } catch {
        // Scene not available (e.g., no experience spec yet) — keep empty snapshot.
      }
      return {
        previewUrl: `file://${path.join(root, ".motion-mcp", "diffs", `${diffId}.json`)}`,
        snapshotImageBase64,
        summary: diff.summary,
        files: diff.files.map((file) => file.path)
      };
    },
    get_credit_balance: ({ rootPath }) => getCreditBalance(resolveRoot(rootPath)),
    purchase_credits_url: async () => purchaseCreditsUrl()
  };
  const bridge = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/tool/")) {
      res.writeHead(404).end("Not found");
      return;
    }
    const name = req.url.replace("/tool/", "");
    const handler = handlers[name];
    if (!handler) {
      res.writeHead(404).end(`Unknown tool ${name}`);
      return;
    }
    try {
      const payload = await readRequestJson(req);
      const result = await handler(payload);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      res
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  bridge.listen(port, () => {
    console.error(`motion-mcp HTTP bridge listening on http://127.0.0.1:${port}`);
  });
}

function readRequestJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

await startHttpBridge();
await server.connect(new StdioServerTransport());
