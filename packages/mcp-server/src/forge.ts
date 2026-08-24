import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyTemperamentToDoc,
  resolveTemperament,
  temperamentProfile,
  type SceneDoc,
  type SceneTemperament
} from "@motion-mcp/scene-graph";
import {
  assembleVideo,
  captureSceneGif,
  hasFfmpeg,
  renderSceneFrames
} from "@motion-mcp/capture";
import { toAnimatedSvg, toLottie } from "@motion-mcp/exporters";
import {
  judgeRenderedFrames,
  lintCurves,
  loadRubric,
  resolveJudgeProvider,
  runRepairLoop,
  type JudgeContext,
  type MotionRubric
} from "@motion-mcp/critic";
import { analyzeSvgAnatomy, buildCharacterRig } from "@motion-mcp/anatomy-engine";
import { generateMotionFromPrompt, type GenerateFromPromptInput } from "@motion-mcp/generation-engine";
import { flattenSvgNodes, parseSvgTree } from "@motion-mcp/svg-parser";
import {
  isGlb,
  proposeRigFromGltf,
  proposeRigFromImage,
  type LoadExternalBuffer
} from "@motion-mcp/perception-engine";
import { nowIso, type AssetIndexResult, type AssetInfo } from "@motion-mcp/shared-types";
import { readDiff } from "./internals.js";
import { buildAmbientFallbackDoc, loadSceneForAsset } from "./scene-source.js";

export interface SceneTargetInput {
  diffId?: string;
  componentId?: string;
}

async function loadSceneForTarget(
  root: string,
  input: SceneTargetInput
): Promise<{ doc: SceneDoc; base: string; componentId: string }> {
  let componentId = input.componentId;
  if (!componentId && input.diffId) {
    const diff = await readDiff(root, input.diffId);
    componentId = diff.componentId;
  }
  if (!componentId) {
    throw new Error("Provide componentId or diffId.");
  }
  try {
    return { ...(await loadSceneForAsset(root, componentId)), componentId };
  } catch {
    return { ...(await buildAmbientFallbackDoc(root, componentId)), componentId };
  }
}

async function resolveSvgSource(
  root: string,
  input: { svg?: string; componentId?: string }
): Promise<{ svgSource: string; assetId?: string }> {
  if (input.svg) return { svgSource: input.svg };
  if (input.componentId) {
    const assets = await loadOptionalAssets(root);
    const asset = assets?.assets.find((candidate) => candidate.id === input.componentId);
    if (asset && asset.type === "svg") {
      return { svgSource: await fs.readFile(path.join(root, asset.path), "utf8"), assetId: asset.id };
    }
  }
  throw new Error("Provide raw `svg` source or an indexed SVG `componentId`.");
}

async function loadOptionalAssets(root: string): Promise<AssetIndexResult | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, ".motion-mcp", "assets.json"), "utf8")) as AssetIndexResult;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Verification-loop tools (module 3 surface)
// ---------------------------------------------------------------------------

export async function lintMotionCurvesTool(
  root: string,
  input: SceneTargetInput & { state?: string }
): Promise<unknown> {
  const rubric = await loadRubric(root);
  const { doc, base } = await loadSceneForTarget(root, input);
  const report = lintCurves(doc, rubric);
  return {
    ok: report.ok,
    score: report.score,
    summary: report.summary,
    checks: report.checks,
    fixes: report.fixes,
    scene: base,
    note: "Curve lint is pure math over the SceneDoc — no rendering. Pair with review_animation for raster evidence."
  };
}

export async function autoRepairTool(
  root: string,
  input: SceneTargetInput & { state?: string; maxAttempts?: number }
): Promise<unknown> {
  const rubric = await loadRubric(root);
  const { doc, base } = await loadSceneForTarget(root, input);
  const result = await runRepairLoop(doc, {
    rubric,
    state: input.state,
    maxAttempts: input.maxAttempts
  });

  const outDir = path.join(root, ".motion-mcp", "critiques");
  await fs.mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, `${base}.repair.json`);
  let repairedDocPath: string | undefined;
  if (result.docChanged) {
    repairedDocPath = path.join(outDir, `${base}.repaired.json`);
    await fs.writeFile(repairedDocPath, `${JSON.stringify(result.finalDoc, null, 2)}\n`, "utf8");
  }
  await fs.writeFile(
    reportPath,
    `${JSON.stringify({ scene: base, ok: result.ok, attempts: result.attempts.length, appliedFixes: result.appliedFixes, finalReport: result.finalReport, repairedDocPath, at: nowIso() }, null, 2)}\n`,
    "utf8"
  );

  return {
    ok: result.ok,
    docChanged: result.docChanged,
    attempts: result.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      score: attempt.report.score,
      summary: attempt.report.summary
    })),
    appliedFixes: result.appliedFixes,
    finalScore: result.finalReport.score,
    remainingIssues: result.finalReport.fixes,
    reportPath: path.relative(root, reportPath).split(path.sep).join("/"),
    repairedDocPath: repairedDocPath ? path.relative(root, repairedDocPath).split(path.sep).join("/") : undefined
  };
}

export async function judgeAgainstReferenceTool(
  root: string,
  input: SceneTargetInput & { state?: string; prompt?: string; maxFrames?: number }
): Promise<unknown> {
  const rubric = await loadRubric(root);
  const { doc, base, componentId } = await loadSceneForTarget(root, input);
  const machine = doc.artboards[0]!.stateMachines[0];
  const stateName =
    input.state ??
    machine?.states.find((candidate) => candidate.stateId === machine.initialStateId)?.name ??
    "play";
  const maxFrames = Math.min(Math.max(input.maxFrames ?? rubric.render.maxFrames, 2), 24);
  const fps = Math.max(1, Math.min(60, Math.round((maxFrames * 1000) / 3400)));
  const { frames } = await renderSceneFrames(doc, { state: stateName, maxFrames, fps });
  const provider = resolveJudgeProvider(rubric.judge);
  const context: JudgeContext = { prompt: input.prompt, stateName, componentId };
  const verdict = await judgeRenderedFrames(frames.map((frame) => frame.png), provider, context);
  return {
    provider: verdict.provider,
    alivenessScore: verdict.alivenessScore,
    threshold: rubric.judge.alivenessThreshold,
    passes: verdict.passes,
    notes: verdict.notes,
    state: stateName,
    scene: base,
    note:
      verdict.provider === "mock"
        ? "Deterministic heuristics — set rubric.judge.provider to gemini or claude (with GEMINI_API_KEY / ANTHROPIC_API_KEY) for model-based judging."
        : undefined
  };
}

// ---------------------------------------------------------------------------
// Temperament tool (ensoulment primitive)
// ---------------------------------------------------------------------------

export type TemperamentInput = string | Partial<SceneTemperament>;

export async function applyTemperamentTool(
  root: string,
  input: {
    temperament: TemperamentInput;
    componentId?: string;
    diffId?: string;
    state?: string;
  }
): Promise<unknown> {
  const resolved = resolveTemperament(input.temperament);
  const profile = temperamentProfile(resolved);
  const { doc, base } = await loadSceneForTarget(root, input);
  const applied = applyTemperamentToDoc(doc, input.temperament);

  const outDir = path.join(root, ".motion-mcp", "scenes");
  await fs.mkdir(outDir, { recursive: true });
  const scenePathRelative = path.join(".motion-mcp", "scenes", `${base}.temperament.json`);
  await fs.writeFile(
    path.join(root, scenePathRelative),
    `${JSON.stringify(applied.doc, null, 2)}\n`,
    "utf8"
  );

  return {
    temperament: applied.temperament,
    presetName: typeof input.temperament === "string" ? input.temperament : undefined,
    profile: applied.profile,
    stagedScenePath: scenePathRelative.split(path.sep).join("/"),
    scene: base,
    nextTool: "review_animation",
    note: "Timing/easing rewritten deterministically; amplitudes untouched. Review before applying anywhere."
  };
}

// ---------------------------------------------------------------------------
// Preview + export tools (delivery loop)
// ---------------------------------------------------------------------------

export const EXPORT_FORMATS = ["animated-svg", "lottie", "gif", "mp4", "webm"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const DESTINATION_FORMATS: Record<string, ExportFormat[]> = {
  web: ["animated-svg"],
  html: ["animated-svg"],
  react: ["animated-svg", "lottie"],
  next: ["animated-svg", "lottie"],
  "react-native": ["lottie", "animated-svg"],
  expo: ["lottie", "animated-svg"],
  ios: ["lottie", "gif"],
  android: ["lottie", "gif"],
  flutter: ["lottie", "gif"],
  unity: ["gif", "webm", "mp4"],
  unreal: ["gif", "webm", "mp4"],
  video: ["mp4", "webm", "gif"]
};

function formatsForDestination(destination: string | undefined): ExportFormat[] {
  if (!destination) return ["animated-svg"];
  return DESTINATION_FORMATS[destination.toLowerCase()] ?? ["animated-svg"];
}

export interface ExportOptions {
  destination?: string;
  format?: string;
  state?: string;
  maxFrames?: number;
  width?: number;
}

export async function exportAssetTool(
  root: string,
  input: SceneTargetInput & ExportOptions
): Promise<unknown> {
  const requested = (input.format ?? "").toLowerCase() as ExportFormat;
  const chain = requested
    ? [requested]
    : formatsForDestination(input.destination);
  const supported = new Set<string>(EXPORT_FORMATS);
  const firstSupported = chain.find((format) => supported.has(format));
  if (!firstSupported) {
    throw new Error(`Unsupported format "${input.format}". Known: ${EXPORT_FORMATS.join(", ")}.`);
  }

  const { doc, base } = await loadSceneForTarget(root, input);
  const outDir = path.join(root, ".motion-mcp", "exports");
  await fs.mkdir(outDir, { recursive: true });

  let chosen: ExportFormat = firstSupported;
  let fileExtension: string = firstSupported;
  let bytes: Uint8Array | undefined;
  let text: string | undefined;
  const fallbacks: string[] = [];

  for (let index = chain.indexOf(firstSupported); index < chain.length; index += 1) {
    const candidate = chain[index]!;
    try {
      if (candidate === "animated-svg") {
        text = toAnimatedSvg(doc, { state: input.state });
      } else if (candidate === "lottie") {
        text = JSON.stringify(toLottie(doc, { state: input.state }));
      } else if (candidate === "gif") {
        const capture = await captureSceneGif(doc, {
          state: input.state,
          maxFrames: input.maxFrames,
          width: input.width
        });
        bytes = capture.gif;
      } else {
        if (!hasFfmpeg()) throw new Error("ffmpeg not on PATH");
        const format = candidate as "mp4" | "webm";
        const rendered = await renderSceneFrames(doc, {
          state: input.state,
          maxFrames: input.maxFrames ?? 60,
          width: input.width
        });
        bytes = await assembleVideo({
          frames: rendered.frames.map((frame) => frame.png),
          fps: rendered.fps,
          format
        });
      }
      chosen = candidate;
      break;
    } catch (error) {
      fallbacks.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (text === undefined && !bytes) {
    throw new Error(`All export formats failed. ${fallbacks.join(" | ")}`);
  }

  fileExtension = chosen === "animated-svg" ? "svg" : chosen === "lottie" ? "json" : chosen;
  const fileName = `${base}.${chosen === "lottie" ? "lottie.json" : fileExtension}`;
  const filePath = path.join(outDir, fileName);
  if (text !== undefined) await fs.writeFile(filePath, text, "utf8");
  else await fs.writeFile(filePath, bytes!);

  return {
    ok: true,
    destination: input.destination,
    requestedFormat: requested || undefined,
    chosenFormat: chosen,
    path: path.relative(root, filePath).split(path.sep).join("/"),
    sizeBytes: text !== undefined ? Buffer.byteLength(text) : bytes!.length,
    fallbackTrail: fallbacks,
    note:
      chain.length > 1 && chosen !== chain[0]
        ? `Destination prefers ${chain[0]} but fell back to ${chosen}; see fallbackTrail.`
        : undefined
  };
}

export async function renderPreviewTool(
  root: string,
  input: SceneTargetInput & { state?: string; maxFrames?: number; width?: number }
): Promise<unknown> {
  const { doc, base } = await loadSceneForTarget(root, input);
  const capture = await captureSceneGif(doc, {
    state: input.state,
    maxFrames: Math.min(Math.max(input.maxFrames ?? 10, 2), 24),
    width: input.width
  });
  return {
    scene: base,
    gifBase64: Buffer.from(capture.gif).toString("base64"),
    frames: capture.frames,
    width: capture.width,
    height: capture.height,
    durationMs: capture.durationMs
  };
}

// ---------------------------------------------------------------------------
// Rig proposal (human-in-the-loop perception seam)
// ---------------------------------------------------------------------------

export async function proposeRigTool(
  root: string,
  input: { svg?: string; componentId?: string }
): Promise<unknown> {
  const { svgSource } = await resolveSvgSource(root, input);
  const anatomy = analyzeSvgAnatomy(svgSource);
  const rig = buildCharacterRig(svgSource);
  return {
    proposalOnly: true,
    speciesId: rig.rig.speciesId ?? "blob",
    matchConfidence: rig.rig.matchConfidence ?? 0,
    boneCount: rig.rig.bones.length,
    ikChains: rig.rig.ikChains.length,
    secondaryMotionCount: rig.rig.secondaryMotion.length,
    capabilities: anatomy.manifest.capabilities.map((capability) => capability.id),
    suggestedStates: rig.suggestedStates,
    rigBlock: rig.rig,
    detectedParts: Object.fromEntries(
      anatomy.parts.map((part) => [part.nodeId, part.role])
    ),
    notes: [
      ...rig.report.notes,
      "Nothing was persisted. Call rig_asset with this componentId/svg to commit the rig."
    ]
  };
}

// ---------------------------------------------------------------------------
// Perception tools (module 1 surface): raster images and glTF meshes
// ---------------------------------------------------------------------------

export async function perceiveImageTool(
  root: string,
  input: {
    imagePath?: string;
    imageBase64?: string;
    maxColors?: number;
    maxParts?: number;
  }
): Promise<unknown> {
  const bytes = await resolveImageBytes(root, input);
  if (looksLikeJpeg(bytes)) {
    throw new Error(
      "JPEG is not decoded locally yet — re-export the image as PNG, or use generate_svg_asset/vectorize_asset for Quiver-based raster tracing."
    );
  }
  const proposal = proposeRigFromImage(bytes, {
    maxColors: input.maxColors,
    maxParts: input.maxParts
  });

  const outDir = path.join(root, ".motion-mcp", "scenes");
  await fs.mkdir(outDir, { recursive: true });
  const svgPath = path.join(outDir, `perceived-${nowIso().replace(/[:.]/g, "-")}.svg`);
  await fs.writeFile(svgPath, proposal.svg, "utf8");

  return {
    ...proposal,
    stagedSvgPath: path.relative(root, svgPath).split(path.sep).join("/"),
    nextTool: "rig_asset"
  };
}

async function resolveImageBytes(
  root: string,
  input: { imagePath?: string; imageBase64?: string }
): Promise<Uint8Array> {
  if (input.imageBase64) return Uint8Array.from(Buffer.from(input.imageBase64, "base64"));
  if (input.imagePath) {
    const resolved = path.resolve(root, input.imagePath);
    return new Uint8Array(await fs.readFile(resolved));
  }
  throw new Error("perceive_image requires imagePath or imageBase64.");
}

function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export async function perceive3dTool(
  root: string,
  input: { meshPath: string; bands?: number }
): Promise<unknown> {
  const meshPath = path.resolve(root, input.meshPath);
  const bytes = new Uint8Array(await fs.readFile(meshPath));

  const loadBuffer: LoadExternalBuffer = async (uri) => {
    const clean = uri.replace(/^\.\//, "");
    return new Uint8Array(await fs.readFile(path.join(path.dirname(meshPath), clean)));
  };

  let proposal;
  try {
    proposal = await proposeRigFromGltf(bytes, { bands: input.bands, loadBuffer });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isGlb(bytes)) throw error;
    if (/gltf/i.test(message)) throw error;
    throw new Error(`Could not parse ${path.basename(meshPath)} as glTF: ${message}. FBX/OBJ are not supported yet.`);
  }

  const outDir = path.join(root, ".motion-mcp", "rigs");
  await fs.mkdir(outDir, { recursive: true });
  const proposalPathRelative = path.join(".motion-mcp", "rigs", `${path.basename(meshPath, path.extname(meshPath))}.rig-proposal.json`);
  await fs.writeFile(path.join(root, proposalPathRelative), `${JSON.stringify(proposal, null, 2)}\n`, "utf8");

  return {
    ...proposal,
    sourceMesh: input.meshPath,
    proposalPath: proposalPathRelative.split(path.sep).join("/"),
    nextTool: "generate_animation",
    note: "Proposal staged for review — no rig was committed."
  };
}

// ---------------------------------------------------------------------------
// Generation tool (module 2 surface): prompt → verified SceneDoc
// ---------------------------------------------------------------------------

export interface GenerateFromPromptToolInput {
  prompt: string;
  temperament?: TemperamentInput;
  componentId?: string;
  svg?: string;
  parts?: string[];
}

export async function generateFromPromptTool(
  root: string,
  input: GenerateFromPromptToolInput
): Promise<unknown> {
  let sourceSvg: string | undefined;
  let parts = input.parts;
  let base = "generated";

  if (input.svg || input.componentId) {
    const resolved = await resolveSvgSource(root, { svg: input.svg, componentId: input.componentId });
    sourceSvg = resolved.svgSource;
    base =
      input.componentId ??
      path.basename((input.componentId ?? "asset"), path.extname(input.componentId ?? "")) ??
      "asset";
    if (!parts || parts.length === 0) {
      parts = parseSvgTree(sourceSvg)
        .flatMap(flattenSvgNodes)
        .filter((node) => Boolean(node.id || node.attrs["data-name"] || node.className))
        .map((node) => node.id ?? node.attrs["data-name"] ?? node.nodeId)
        .slice(0, 24);
    }
  }

  const generationInput: GenerateFromPromptInput = {
    prompt: input.prompt,
    temperament: input.temperament,
    parts,
    name: `prompt:${truncateForName(input.prompt)}`,
    sourceSvg
  };
  const result = generateMotionFromPrompt(generationInput);

  const outDir = path.join(root, ".motion-mcp", "scenes");
  await fs.mkdir(outDir, { recursive: true });
  const scenePathRelative = path.join(".motion-mcp", "scenes", `${base}.prompt.json`);
  await fs.writeFile(path.join(root, scenePathRelative), `${JSON.stringify(result.doc, null, 2)}\n`, "utf8");

  return {
    ok: result.selfCheck.ok && result.selfCheck.schemaValid,
    prompt: input.prompt,
    intent: result.parsed.primary,
    matchedIntents: result.parsed.all.map((intent) => intent.action),
    unmatchedTokens: result.parsed.unmatchedTokens,
    temperament: result.doc.artboards[0]!.temperament,
    profile: result.profile,
    states: result.doc.artboards[0]!.stateMachines[0]!.states.map((state) => state.name),
    selfCheck: {
      ok: result.selfCheck.ok,
      schemaValid: result.selfCheck.schemaValid,
      schemaErrors: result.selfCheck.schemaErrors,
      score: result.selfCheck.score,
      summary: result.selfCheck.summary,
      issues: result.selfCheck.checks.filter((check) => check.severity !== "pass"),
      fixes: result.selfCheck.fixes
    },
    notes: result.notes,
    stagedScenePath: scenePathRelative.split(path.sep).join("/"),
    partsTargeted: parts ?? ["*"],
    nextTool: result.selfCheck.ok ? "review_animation" : "auto_repair"
  };
}

function truncateForName(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function verifyCrossRuntimeTool(
  root: string,
  input: SceneTargetInput & { state?: string; fps?: number }
): Promise<unknown> {
  const { verifyExportParity } = await import("@motion-mcp/exporters");
  const { doc, base } = await loadSceneForTarget(root, input);
  const report = verifyExportParity(doc, { state: input.state, fps: input.fps });
  return {
    ...report,
    scene: base,
    nextTool: report.ok ? "export_asset" : "auto_repair",
    note: report.note
  };
}

// ---------------------------------------------------------------------------
// docs-MCP: grounded search over motion-mcp's own schema + docs
// ---------------------------------------------------------------------------

interface DocChunk {
  source: string;
  title: string;
  text: string;
}

const DOC_SOURCES = [
  "README.md",
  "docs/architecture.md",
  "docs/scenedoc-v1-extensions.md",
  "docs/research-and-continuation-prompt.md"
];

function repoRoot(): string {
  if (process.env.MOTION_MCP_REPO_ROOT) return process.env.MOTION_MCP_REPO_ROOT;
  return fileURLToPath(new URL("../../..", import.meta.url));
}

export async function motionDocsSearch(query: string, limit = 5): Promise<unknown> {
  const root = repoRoot();
  const chunks: DocChunk[] = [];
  for (const relative of DOC_SOURCES) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(root, relative), "utf8");
    } catch {
      continue;
    }
    const sections = raw.split(/\n(?=#{2,3} )/g);
    for (const section of sections) {
      const titleMatch = section.match(/^#{2,3} (.+)$/m);
      chunks.push({
        source: relative,
        title: titleMatch?.[1]?.trim() ?? relative,
        text: section.trim().slice(0, 1200)
      });
    }
  }

  const tokens = query.toLowerCase().split(/[^a-z0-9_.-]+/).filter((token) => token.length >= 3);
  const scored = chunks.map((chunk) => {
    const haystack = chunk.text.toLowerCase();
    const titleHaystack = chunk.title.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (titleHaystack.includes(token)) score += 3;
      const occurrences = haystack.split(token).length - 1;
      score += Math.min(occurrences, 5);
    }
    return { ...chunk, score };
  });
  const hits = scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...chunk }) => ({ score, ...chunk }));

  return {
    query,
    indexedFiles: DOC_SOURCES,
    hits,
    hint:
      "Grounding corpus covers SceneDoc schema, extension contract, and architecture. Rive runtime docs are NOT bundled."
  };
}
