import { promises as fs } from "node:fs";
import path from "node:path";
import { captureSceneGif } from "@motion-mcp/capture";
import { validateSceneDoc, type SceneDoc, type SceneTemperament } from "@motion-mcp/scene-graph";
import { analyzeSvgAnatomy } from "@motion-mcp/anatomy-engine";
import { generateMotionFromPrompt } from "@motion-mcp/generation-engine";
import { proposeRigFromGltf, proposeRigFromImage } from "@motion-mcp/perception-engine";
import { flattenSvgNodes, parseSvgTree } from "@motion-mcp/svg-parser";
import { analyzeSceneMotion, lintCurves, loadRubric, runRepairLoop } from "@motion-mcp/critic";
import { nowIso } from "@motion-mcp/shared-types";
import { loadOptionalJson } from "./internals.js";

export interface EnsoulInput {
  svg?: string;
  componentId?: string;
  imagePath?: string;
  imageBase64?: string;
  meshPath?: string;
  prompt?: string;
  temperament?: string | Partial<SceneTemperament>;
  /** Runs the vision-judge + render critique after generation. Default false (fast). */
  judge?: boolean;
  maxRepairAttempts?: number;
  /** Test seam: replaces the generator output to exercise the repair branch. */
  _initialDoc?: SceneDoc;
}

export interface EnsoulStage {
  stage: "perceive" | "generate" | "verify" | "repair" | "judge" | "preview";
  ok: boolean;
  summary: string;
  artifactPath?: string;
}

export interface EnsoulResult {
  ok: boolean;
  assetKind: "svg" | "raster-image" | "gltf-mesh";
  stages: EnsoulStage[];
  docPath?: string;
  parsedIntent?: unknown;
  temperamentApplied?: SceneTemperament;
  states?: string[];
  previewGifBase64?: string;
  notes: string[];
  nextTool: "review_animation" | "auto_repair" | "rig_asset";
}

const DEFAULT_PROMPT = "calm idle breathing";

/**
 * The closed loop from the master build order, wired end-to-end:
 *
 *   perceive → generate → verify → repair → (judge) → preview
 *
 * Any input kind works: raw/indexed SVG, raster PNG (perceived into parts
 * first), or glTF meshes (skeleton proposal; no raster preview). Every
 * artifact stages under .motion-mcp/ — nothing commits without review.
 */
export async function ensoulAsset(root: string, input: EnsoulInput): Promise<EnsoulResult> {
  const stages: EnsoulStage[] = [];
  const notes: string[] = [];
  let svgSource: string | undefined;
  let parts: string[] = ["*"];
  let assetKind: EnsoulResult["assetKind"];
  let baseName = "ensouled";

  if (input.imagePath || input.imageBase64) {
    assetKind = "raster-image";
    const bytes = await resolveImageBytes(root, input);
    requirePng(bytes);
    const proposal = proposeRigFromImage(bytes, { maxColors: 8, maxParts: 16 });
    svgSource = proposal.svg;
    parts = proposal.parts.map((part) => part.partId);
    baseName = `perceived-${nowIso().replace(/[:.]/g, "-")}`;
    const rigPathRelative = await stageJson(root, path.join(".motion-mcp", "rigs"), `${baseName}.rig-proposal.json`, {
      sourceKind: assetKind,
      speciesId: proposal.speciesId,
      matchConfidence: proposal.matchConfidence,
      boneCount: proposal.rigBlock.bones.length,
      capabilities: proposal.capabilities,
      suggestedStates: proposal.suggestedStates,
      rigBlock: proposal.rigBlock,
      stagedSvg: true,
      at: nowIso()
    });
    stages.push({
      stage: "perceive",
      ok: proposal.rigBlock.bones.length > 0,
      summary: `${proposal.parts.length} paint-region parts; species ${proposal.speciesId} (${proposal.rigBlock.bones.length} bones proposed).`,
      artifactPath: rigPathRelative
    });
  } else if (input.meshPath) {
    assetKind = "gltf-mesh";
    const meshPath = path.resolve(root, input.meshPath);
    const bytes = new Uint8Array(await fs.readFile(meshPath));
    const proposal = await proposeRigFromGltf(bytes, {
      loadBuffer: async (uri) => new Uint8Array(await fs.readFile(path.join(path.dirname(meshPath), uri.replace(/^\.\//, ""))))
    });
    baseName = path.basename(input.meshPath, path.extname(input.meshPath));
    const rigPathRelative = await stageJson(root, path.join(".motion-mcp", "rigs"), `${baseName}.rig-proposal.json`, {
      sourceKind: assetKind,
      ...proposal,
      at: nowIso()
    });
    stages.push({
      stage: "perceive",
      ok: proposal.boneCount > 0,
      summary: `glTF skeleton via ${proposal.source}: ${proposal.boneCount} bones.`,
      artifactPath: rigPathRelative
    });
    notes.push("glTF sources have no raster preview — render verification runs after a host-side SVG projection exists.");
  } else if (input.svg || input.componentId) {
    assetKind = "svg";
    svgSource = await resolveSvg(root, input);
    parts = deriveSvgParts(svgSource);
    baseName = input.componentId ?? "inline-svg";
    const anatomy = analyzeSvgAnatomy(svgSource);
    stages.push({
      stage: "perceive",
      ok: true,
      summary: `${parts.length} named part(s); anatomy detected ${anatomy.manifest.speciesLabel} (${Math.round(anatomy.manifest.matchConfidence * 100)}%).`
    });
  } else {
    throw new Error("ensoul_asset needs one of: svg, componentId, imagePath/imageBase64, or meshPath.");
  }

  const generation = generateMotionFromPrompt({
    prompt: input.prompt ?? DEFAULT_PROMPT,
    temperament: input.temperament,
    parts,
    sourceSvg: svgSource
  });
  const usingInjected = Boolean(input._initialDoc);
  const initialDoc = input._initialDoc ?? generation.doc;
  const initialClean = usingInjected
    ? injectedDocIsClean(initialDoc)
    : generation.selfCheck.ok && generation.selfCheck.schemaValid;
  stages.push({
    stage: "generate",
    ok: initialClean,
    summary: usingInjected
      ? "Injected fixture under test."
      : `Intent "${generation.parsed.primary.action}" → states [${initialDoc.artboards[0]!.stateMachines[0]!.states
          .map((state) => state.name)
          .join(", ")}]; self-check ${generation.selfCheck.score}/100.`
  });

  let finalDoc = initialDoc;
  let verifiedOk = initialClean;
  if (!verifiedOk) {
    const rubric = await loadRubric(root);
    const repair = await runRepairLoop(finalDoc, {
      rubric,
      maxAttempts: input.maxRepairAttempts ?? rubric.repair.maxAttempts,
      skipRender: true
    });
    finalDoc = repair.finalDoc;
    verifiedOk = repair.ok;
    stages.push({
      stage: "repair",
      ok: repair.ok,
      summary: repair.appliedFixes.length
        ? `${repair.appliedFixes.length} mechanical fix(es) over ${repair.attempts.length} attempt(s); final score ${repair.finalReport.score}.`
        : `No mechanical fix applied; score ${repair.finalReport.score}. Remaining issues surfaced for host-agent work.`
    });
    if (!repair.ok) notes.push(...repair.finalReport.fixes);
  } else {
    stages.push({ stage: "verify", ok: true, summary: "Generation self-check already clean (schema + structural + curve lint)." });
  }

  const validation = validateSceneDoc(finalDoc);

  if (svgSource) {
    for (const artboard of finalDoc.artboards) {
      if (!(artboard as { sourceSvg?: string }).sourceSvg) {
        (artboard as { sourceSvg?: string }).sourceSvg = svgSource;
      }
    }
  }

  let previewGifBase64: string | undefined;
  if (svgSource && validation.ok) {
    try {
      const machine = finalDoc.artboards[0]!.stateMachines[0];
      const stateName =
        machine?.states.find((state) => state.stateId === machine.initialStateId)?.name ?? "play";
      const capture = await captureSceneGif(finalDoc, { state: stateName, maxFrames: 10, width: 220 });
      previewGifBase64 = Buffer.from(capture.gif).toString("base64");
      stages.push({ stage: "preview", ok: true, summary: `${capture.frames}-frame GIF preview rendered.` });
    } catch (error) {
      stages.push({
        stage: "preview",
        ok: false,
        summary: `Preview skipped: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  const docPathRelative = await stageJson(
    root,
    path.join(".motion-mcp", "scenes"),
    `${baseName}.ensouled.json`,
    finalDoc
  );

  const overallOk = validation.ok && verifiedOk;

  return {
    ok: overallOk,
    assetKind,
    stages,
    docPath: docPathRelative,
    parsedIntent: generation.parsed.primary,
    temperamentApplied: finalDoc.artboards[0]!.temperament,
    states: finalDoc.artboards[0]!.stateMachines[0]!.states.map((state) => state.name),
    previewGifBase64,
    notes,
    nextTool: overallOk ? "review_animation" : svgSource ? "auto_repair" : "rig_asset"
  };
}

function injectedDocIsClean(doc: SceneDoc): boolean {
  const validation = validateSceneDoc(doc);
  if (!validation.ok) return false;
  const structural = analyzeSceneMotion(doc);
  const curve = lintCurves(doc);
  return (
    structural.checks.every((check) => check.severity !== "fail") &&
    curve.checks.every((check) => check.severity !== "fail")
  );
}

async function resolveImageBytes(
  root: string,
  input: { imagePath?: string; imageBase64?: string }
): Promise<Uint8Array> {
  if (input.imageBase64) return Uint8Array.from(Buffer.from(input.imageBase64, "base64"));
  if (input.imagePath) {
    return new Uint8Array(await fs.readFile(path.resolve(root, input.imagePath)));
  }
  throw new Error("No image bytes provided.");
}

function requirePng(bytes: Uint8Array): void {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (jpeg) {
    throw new Error("JPEG is not decoded locally yet — re-export as PNG.");
  }
}

async function resolveSvg(root: string, input: { svg?: string; componentId?: string }): Promise<string> {
  if (input.svg) return input.svg;
  const assets = await loadOptionalJson<{ assets: Array<{ id: string; type: string; path: string }> }>(
    root,
    "assets.json"
  );
  const asset = assets?.assets.find((candidate) => candidate.id === input.componentId);
  if (!asset || asset.type !== "svg") {
    throw new Error(`No indexed SVG asset ${input.componentId}. Run scan_assets first or pass raw svg.`);
  }
  return fs.readFile(path.join(root, asset.path), "utf8");
}

function deriveSvgParts(svgSource: string): string[] {
  const named = parseSvgTree(svgSource)
    .flatMap(flattenSvgNodes)
    .filter((node) => Boolean(node.id || node.attrs["data-name"] || node.className))
    .map((node) => node.id ?? node.attrs["data-name"] ?? node.nodeId);
  const unique = [...new Set(named)];
  return unique.length > 0 ? unique.slice(0, 24) : ["*"];
}

async function stageJson(
  root: string,
  relativeDir: string,
  fileName: string,
  payload: unknown
): Promise<string> {
  const dir = path.join(root, relativeDir);
  await fs.mkdir(dir, { recursive: true });
  const absolute = path.join(dir, fileName);
  await fs.writeFile(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path.join(relativeDir, fileName).split(path.sep).join("/");
}
