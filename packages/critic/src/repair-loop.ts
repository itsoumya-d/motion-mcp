import type { SceneDoc } from "@motion-mcp/scene-graph";
import { autoFixScene } from "./autofix.js";
import { critiqueScene } from "./render.js";
import type { MotionCritique } from "./checks.js";
import { loadRubric, type MotionRubric } from "./rubric.js";

export interface RepairAttempt {
  /** 1-based attempt number. */
  attempt: number;
  report: MotionCritique;
  fixesApplied: string[];
}

export interface RepairLoopOptions extends Omit<import("./render.js").CritiqueOptions, "judge"> {
  rubric?: MotionRubric;
  /** Overrides rubric.repair.maxAttempts. */
  maxAttempts?: number;
  judge?: import("./render.js").CritiqueOptions["judge"];
  /** Test seam: replace the whole critique pass. */
  critiqueFn?: (doc: SceneDoc) => Promise<MotionCritique>;
}

export interface RepairLoopResult {
  ok: boolean;
  docChanged: boolean;
  finalDoc: SceneDoc;
  finalReport: MotionCritique;
  attempts: RepairAttempt[];
  appliedFixes: string[];
}

/**
 * The closed verification-and-repair loop (MOTIONFORGE module 3):
 *
 *   critique → scoped mechanical repair → re-critique → … until the report
 *   passes or attempts run out — then surface everything to the human.
 *
 * Repairs are limited to the rubric's allowlist of deterministic,
 * segment-scoped fixes; the loop never invents motion. Anything it cannot
 * fix mechanically is reported with actionable guidance for the host agent.
 */
export async function runRepairLoop(
  doc: SceneDoc,
  options: RepairLoopOptions = {}
): Promise<RepairLoopResult> {
  const rubric = options.rubric ?? (await loadRubric());
  const maxAttempts = Math.max(1, options.maxAttempts ?? rubric.repair.maxAttempts);
  const critiqueFn =
    options.critiqueFn ??
    ((candidate: SceneDoc) => critiqueScene(candidate, { ...options, rubric }));

  const attempts: RepairAttempt[] = [];
  let current = doc;
  let totalFixes: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const report = await critiqueFn(current);
    attempts.push({ attempt, report, fixesApplied: [...totalFixes] });
    if (report.ok && report.score >= rubric.scoring.passThreshold) {
      return done(current, report, attempts, totalFixes, true);
    }
    if (attempt === maxAttempts) break;

    const fixed = autoFixScene(current, { rubric });
    if (fixed.applied.length === 0) break;
    totalFixes = [...totalFixes, ...fixed.applied];
    current = fixed.doc;
  }

  const lastReport = attempts[attempts.length - 1]?.report ?? (await critiqueFn(current));
  return done(current, lastReport, attempts, totalFixes, false);
}

function done(
  doc: SceneDoc,
  report: MotionCritique,
  attempts: RepairAttempt[],
  fixes: string[],
  ok: boolean
): RepairLoopResult {
  return {
    ok,
    docChanged: fixes.length > 0,
    finalDoc: doc,
    finalReport: report,
    attempts,
    appliedFixes: fixes
  };
}
