import { promises as fs } from "node:fs";
import path from "node:path";
import {
  renderFrameToSvg,
  snapshotToSceneDoc,
  type FigmaSnapshot
} from "@motion-mcp/figma-bridge";
import type { FileChange } from "@motion-mcp/shared-types";
import { nowIso, stableId } from "@motion-mcp/shared-types";
import { toUnifiedDiff, writeDiff, upsertIndexedAsset } from "./internals.js";

export interface FigmaImportInput {
  snapshotPath?: string;
  snapshot?: unknown;
  name?: string;
}

export interface FigmaImportResult {
  ok: boolean;
  diffId: string;
  assetId: string;
  assetPath: string;
  scenePath: string;
  svgPath: string;
  artboards: number;
  states: number;
  transitions: number;
  parts: number;
  nextTools: string[];
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "figma-import";
}

/**
 * B2 Figma bridge: ingests a plugin-exported FigmaBridgeSnapshot, synthesizes
 * a SceneDoc state machine (smart-animate pose tweens between frames), and
 * stages the import as a reviewable, playable diff.
 */
export async function importFigmaScene(root: string, input: FigmaImportInput): Promise<FigmaImportResult> {
  let raw: unknown = input.snapshot;
  if (!raw && input.snapshotPath) {
    const absolute = path.resolve(root, input.snapshotPath);
    raw = JSON.parse(await fs.readFile(absolute, "utf8"));
  }
  const snapshot = validateSnapshot(raw);

  const doc = snapshotToSceneDoc(snapshot);
  if (doc.artboards.length === 0) {
    throw new Error("Snapshot contains no frames to import.");
  }

  // Entry-frame SVG so capture/preview pipelines can play the import.
  const entryFrame =
    snapshot.frames.find((frame) => frame.id === doc.artboards[0]!.artboardId.replace(/^figma_/, "")) ??
    snapshot.frames[0]!;
  const layeredSvg = renderFrameToSvg(entryFrame);
  (doc.artboards[0] as { sourceSvg?: string }).sourceSvg = layeredSvg;

  const baseName = slugify(input.name ?? snapshot.file ?? "figma-bridge");
  const relativeSvg = `.motion-mcp/generated-assets/${baseName}.svg`;
  const relativeScene = `.motion-mcp/figma/${baseName}/scene.json`;
  await fs.mkdir(path.join(root, path.dirname(relativeSvg)), { recursive: true });
  await fs.mkdir(path.join(root, path.dirname(relativeScene)), { recursive: true });
  await fs.writeFile(path.join(root, relativeSvg), layeredSvg, "utf8");
  await fs.writeFile(path.join(root, relativeScene), `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  // Index the SVG asset with bridge metadata in semantic labels.
  const partCount = new Set(entryFrame.elements.map((element) => element.id)).size;
  const stateCount = doc.artboards[0]!.stateMachines[0]!.states.length;
  const transitionCount = doc.artboards.reduce((sum, artboard) => sum + artboard.stateMachines[0]!.transitions.length, 0);
  const asset = {
    id: stableId("asset", relativeSvg),
    path: relativeSvg,
    type: "svg" as const,
    source: "generated" as const,
    semanticLabels: [
      "figma-bridge",
      `frames:${snapshot.frames.length}`,
      `states:${stateCount}`,
      `transitions:${transitionCount}`
    ],
    sizeBytes: Buffer.byteLength(layeredSvg, "utf8")
  };
  await upsertIndexedAsset(root, asset);

  const files: FileChange[] = [
    { path: relativeSvg, mode: "create", content: `${layeredSvg}\n` },
    { path: relativeScene, mode: "create", content: `${JSON.stringify(doc, null, 2)}\n` }
  ];
  const diffId = stableId("diff", `figma:${relativeScene}:${nowIso()}`);
  await writeDiff(root, {
    diffId,
    rootPath: root,
    componentId: asset.id,
    summary: `Figma bridge import${snapshot.file ? ` (${snapshot.file})` : ""}: ${snapshot.frames.length} frames → ${stateCount} states, ${transitionCount} smart-animate transitions across ${doc.artboards.length} artboard(s).`,
    framework: "unknown",
    creditsConsumed: 10,
    validationStatus: {
      ok: true,
      skipped: true,
      reason: "Staged import; validation runs after apply_motion_diff."
    },
    files,
    unifiedDiff: toUnifiedDiff(files),
    createdAt: nowIso()
  });

  return {
    ok: true,
    diffId,
    assetId: asset.id,
    assetPath: relativeSvg,
    scenePath: relativeScene,
    svgPath: relativeSvg,
    artboards: doc.artboards.length,
    states: stateCount,
    transitions: transitionCount,
    parts: partCount,
    nextTools: ["capture_gif", "generate_animation"]
  };
}

function validateSnapshot(raw: unknown): FigmaSnapshot {
  const candidate = raw as FigmaSnapshot | undefined;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.frames) ||
    candidate.frames.length === 0
  ) {
    throw new Error(
      "Not a valid figma-bridge snapshot. Export one via the figma-bridge plugin (apps/figma-bridge) and pass its JSON."
    );
  }
  for (const frame of candidate.frames) {
    if (!frame.id || !Array.isArray(frame.elements)) {
      throw new Error(`Invalid frame entry: id and elements are required.`);
    }
  }
  return candidate;
}
