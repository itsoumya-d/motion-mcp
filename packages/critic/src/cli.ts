#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { SceneDoc } from "@motion-mcp/scene-graph";
import { loadRubric } from "./rubric.js";
import { runRepairLoop } from "./repair-loop.js";

interface CliArgs {
  scenePath: string;
  state?: string;
  rubricPath?: string;
  maxAttempts?: number;
  outPath?: string;
  skipRender: boolean;
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        state: { type: "string" },
        rubric: { type: "string" },
        "max-attempts": { type: "string", short: "n" },
        out: { type: "string", short: "o" },
        "skip-render": { type: "boolean", default: false }
      }
    });
  } catch (error) {
    printUsage(String(error));
    return 2;
  }

  const [scenePath] = parsed.positionals;
  if (!scenePath) {
    printUsage("A SceneDoc JSON path is required.");
    return 2;
  }
  const args: CliArgs = {
    scenePath: path.resolve(scenePath),
    state: parsed.values.state,
    rubricPath: parsed.values.rubric,
    maxAttempts: parsed.values["max-attempts"] ? Number(parsed.values["max-attempts"]) : undefined,
    outPath: parsed.values.out ? path.resolve(parsed.values.out) : undefined,
    skipRender: Boolean(parsed.values["skip-render"])
  };

  const raw = await fs.readFile(args.scenePath, "utf8");
  const doc = JSON.parse(raw) as SceneDoc;

  const projectRoot = path.dirname(args.scenePath);
  const rubric = await loadRubric(projectRoot, args.rubricPath);

  const result = await runRepairLoop(doc, {
    rubric,
    state: args.state,
    maxAttempts: args.maxAttempts,
    skipRender: args.skipRender
  });

  const report = {
    scenePath: args.scenePath,
    ok: result.ok,
    docChanged: result.docChanged,
    attempts: result.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      score: attempt.report.score,
      ok: attempt.report.ok,
      summary: attempt.report.summary,
      checks: attempt.report.checks,
      fixesAppliedBeforeThisAttempt: attempt.fixesApplied
    })),
    appliedFixes: result.appliedFixes,
    finalReport: result.finalReport,
    repairedDocPath: undefined as string | undefined
  };

  const outPath = args.outPath ?? args.scenePath.replace(/\.json$/i, ".repair-report.json");
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (result.docChanged) {
    const repairedPath = args.scenePath.replace(/\.json$/i, ".repaired.json");
    await fs.writeFile(repairedPath, `${JSON.stringify(result.finalDoc, null, 2)}\n`, "utf8");
    report.repairedDocPath = repairedPath;
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  for (const attempt of result.attempts) {
    console.log(`attempt ${attempt.attempt}: score ${attempt.report.score} — ${attempt.report.summary}`);
  }
  if (result.appliedFixes.length > 0) {
    for (const fix of result.appliedFixes) console.log(`fix: ${fix}`);
  } else {
    console.log("fix: none applicable (mechanical repairs exhausted)");
  }
  console.log(`result: ${result.ok ? "PASS" : "NEEDS ATTENTION"} — report at ${outPath}`);
  return result.ok ? 0 : 1;
}

function printUsage(reason: string): void {
  console.error(`${reason}
usage: critic <scene.json> [--state <name>] [--rubric <rubric.json>] [-n <attempts>] [-o <report.json>] [--skip-render]`);
}

process.exitCode = await main();
