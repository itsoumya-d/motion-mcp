import { promises as fs } from "node:fs";
import path from "node:path";
import { critiqueScene, loadRubric } from "@motion-mcp/critic";
import { nowIso } from "@motion-mcp/shared-types";
import { loadSceneForAsset, buildAmbientFallbackDoc } from "./scene-source.js";

export interface ReviewInput {
  diffId?: string;
  componentId?: string;
  state?: string;
  maxFrames?: number;
}

export interface ReviewResult {
  ok: boolean;
  score: number;
  summary: string;
  checks: Array<{ id: string; severity: string; message: string; evidence?: string }>;
  fixes: string[];
  componentId: string;
  stateReviewed: string;
  reportPath: string;
  nextTool: "apply_motion_diff" | "generate_animation";
}

/**
 * C1 self-verifying loop: loads the compiled scene for a diff or component
 * (falling back to an ambient scene when no page experience exists), runs
 * structural + headless-render critique, and persists the report under
 * .motion-mcp/critiques/ so accept/reject telemetry can accumulate.
 */
export async function reviewAnimation(
  root: string,
  input: ReviewInput,
  slugifyValue?: (value: string) => string
): Promise<ReviewResult> {
  const slug = slugifyValue ?? defaultSlug;
  let targetComponentId = input.componentId;
  if (!targetComponentId && input.diffId) {
    const { readDiff } = await import("./internals.js");
    const diff = await readDiff(root, input.diffId);
    targetComponentId = diff.componentId;
  }
  if (!targetComponentId) {
    throw new Error("review_animation requires diffId or componentId.");
  }

  let doc;
  let base: string;
  try {
    ({ doc, base } = await loadSceneForAsset(root, targetComponentId));
  } catch {
    ({ doc, base } = await buildAmbientFallbackDoc(root, targetComponentId));
  }

  const machine = doc.artboards[0]!.stateMachines[0];
  const stateName =
    input.state ??
    machine?.states.find((candidate) => candidate.stateId === machine.initialStateId)?.name ??
    machine?.states[0]?.name ??
    "play";

  const rubric = await loadRubric(root);
  const report = await critiqueScene(doc, { state: stateName, maxFrames: input.maxFrames, rubric });
  const reportDir = path.join(root, ".motion-mcp", "critiques");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPathRelative = path.join(".motion-mcp", "critiques", `${base}.${slug(stateName)}.json`);
  await fs.writeFile(
    path.join(root, reportPathRelative),
    `${JSON.stringify({ componentId: targetComponentId, state: stateName, reviewedAt: nowIso(), ...report }, null, 2)}\n`,
    "utf8"
  );

  return {
    ok: report.ok,
    score: report.score,
    summary: report.summary,
    checks: report.checks.map(({ id, severity, message, evidence }) => ({ id, severity, message, evidence })),
    fixes: report.fixes,
    componentId: targetComponentId,
    stateReviewed: stateName,
    reportPath: reportPathRelative.split(path.sep).join("/"),
    nextTool: report.ok ? "apply_motion_diff" : "generate_animation"
  };
}

function defaultSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "state";
}
