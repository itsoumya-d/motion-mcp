import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RUBRIC,
  MockJudgeProvider,
  runRepairLoop,
  type JudgeContext,
  type JudgeVerdict
} from "../packages/critic/src/index.ts";
import { lintCurves, analyzeSceneMotion } from "../packages/critic/src/index.ts";
import type { SceneDoc } from "../packages/scene-graph/src/index.ts";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE_PATH = path.join(REPO_ROOT, "examples", "verify-loop", "broken-scene.json");

async function loadFixture(): Promise<SceneDoc> {
  return JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8")) as SceneDoc;
}

/** Structural + curve critique only — keeps repair-loop tests off the renderer. */
function fastCritique(doc: SceneDoc) {
  const structural = analyzeSceneMotion(doc);
  const curve = lintCurves(doc);
  const checks = [...structural.checks, ...curve.checks];
  const fails = checks.filter((check) => check.severity === "fail").length;
  return Promise.resolve({
    ok: fails === 0,
    score: structural.score - curve.checks.filter((check) => check.severity === "warn").length * 8,
    checks,
    fixes: [...structural.fixes, ...curve.fixes],
    summary: structural.summary
  });
}

test("repair loop mechanically heals the broken fixture and records a ledger", async () => {
  const broken = await loadFixture();
  const result = await runRepairLoop(broken, {
    rubric: mergeForFastTests(),
    maxAttempts: 3,
    judge: false,
    skipRender: true
  });

  assert.equal(result.ok, true, JSON.stringify(result.finalReport.checks, null, 2));
  assert.ok(result.docChanged);
  assert.ok(result.appliedFixes.length >= 4, result.appliedFixes.join("; "));
  for (const needle of ["sorted keys", "clamped opacity", "loop wrap key", "linear easing"]) {
    assert.ok(
      result.appliedFixes.some((fix) => fix.includes(needle)),
      `expected a "${needle}" fix in ${JSON.stringify(result.appliedFixes)}`
    );
  }
  assert.ok(result.attempts.length >= 2);
  assert.equal(result.attempts[0]!.report.ok, false);
  assert.deepEqual(result.attempts[0]!.fixesApplied, []);
  assert.ok(result.finalReport.score > result.attempts[0]!.report.score);

  const finalCurve = lintCurves(result.finalDoc);
  assert.equal(finalCurve.ok, true);
});

test("repair loop stops at maxAttempts on unfixable motion", async () => {
  const doc = await loadFixture();
  let calls = 0;
  const result = await runRepairLoop(doc, {
    rubric: mergeForFastTests(),
    maxAttempts: 2,
    judge: false,
    critiqueFn: async () => {
      calls += 1;
      return {
        ok: false,
        score: 40,
        checks: [{ id: "judge-aliveness", severity: "fail", message: "motion reads lifeless (stub)" }],
        fixes: ["regenerate with more personality"],
        summary: "stub failure"
      };
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.ok, false);
  assert.ok(result.finalReport.fixes.length > 0);
});

test("repair loop halts early when no mechanical fix applies", async () => {
  const doc = await loadFixture();
  const alreadyClean = structuredClone(doc);
  const artboard = alreadyClean.artboards[0]!;
  artboard.clips["clip-broken"]!.tracks = [
    {
      targetPart: "*",
      property: "scale",
      keys: [
        { t: 0, value: 1 },
        { t: 300, value: 1.05, easing: "easeInOut" },
        { t: 600, value: 1, easing: "easeInOut" }
      ]
    }
  ];
  let calls = 0;
  const result = await runRepairLoop(alreadyClean, {
    rubric: mergeForFastTests(),
    maxAttempts: 5,
    judge: false,
    critiqueFn: async () => {
      calls += 1;
      return {
        ok: false,
        score: 70,
        checks: [{ id: "render-blank", severity: "fail", message: "frames blank (unfixable by design here)" }],
        fixes: ["attach artwork"],
        summary: "stub"
      };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.docChanged, false);
  assert.equal(result.ok, false);
});

function mergeForFastTests() {
  return DEFAULT_RUBRIC;
}

// ---------------------------------------------------------------------------
// MockJudgeProvider determinism + discrimination (no rendering involved)
// ---------------------------------------------------------------------------

function syntheticFrames(count: number, amplitude: number): Array<{ rgba: Uint8Array; width: number; height: number }> {
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const rgba = new Uint8Array(64 * 64 * 4).fill(255);
    const center = Math.round(16 + (Math.sin((index / count) * Math.PI * 2) + 1) * amplitude);
    for (let y = center; y < center + 12; y += 1) {
      for (let x = 16; x < 48; x += 1) {
        const offset = (y * 64 + x) * 4;
        rgba[offset] = 200;
        rgba[offset + 1] = 30;
        rgba[offset + 2] = 30;
      }
    }
    frames.push({ rgba, width: 64, height: 64 });
  }
  return frames;
}

const JUDGE_CONTEXT: JudgeContext = { stateName: "idle-breathe" };

test("mock judge is deterministic and separates still from moving output", async () => {
  const provider = new MockJudgeProvider();
  const animated = syntheticFrames(6, 10);
  const still = syntheticFrames(6, 0);

  const first = await provider.judge(animated, JUDGE_CONTEXT);
  const second = await provider.judge(animated, JUDGE_CONTEXT);
  assert.deepEqual(first, second);
  assert.ok(first.alivenessScore >= 60, `animated scored ${first.alivenessScore}`);

  const stillVerdict: JudgeVerdict = await provider.judge(still, JUDGE_CONTEXT);
  assert.ok(stillVerdict.alivenessScore < first.alivenessScore);
  assert.ok(stillVerdict.alivenessScore < 50, `static scored ${stillVerdict.alivenessScore}`);
  assert.equal(stillVerdict.passes, false);
  assert.ok(first.notes.some((note) => note.includes("not a model judgment")));
});

// ---------------------------------------------------------------------------
// CLI end-to-end against the shipped fixture
// ---------------------------------------------------------------------------

test("critic CLI repairs the fixture and exits clean", { timeout: 180000 }, async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "critic-cli-"));
  const scenePath = path.join(workDir, "scene.json");
  await fs.copyFile(FIXTURE_PATH, scenePath);

  const cliEntry = path.join(REPO_ROOT, "packages", "critic", "src", "cli.ts");
  const exitCode = await new Promise<number>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", cliEntry, scenePath],
      { cwd: REPO_ROOT, timeout: 120000 },
      (error) => resolve(error ? Number((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0)
    );
  });

  assert.equal(exitCode, 0, "CLI should pass once the loop repairs the fixture");
  const report = JSON.parse(await fs.readFile(scenePath.replace(/\.json$/, ".repair-report.json"), "utf8"));
  assert.equal(report.ok, true);
  assert.ok(report.repairedDocPath);
  const repaired = JSON.parse(await fs.readFile(report.repairedDocPath!, "utf8")) as SceneDoc;
  const scaleTrack = repaired.artboards[0]!.clips["clip-broken"]!.tracks.find((track) => track.property === "scale")!;
  assert.deepEqual(scaleTrack.keys.map((key) => key.t), [0, 240, 600]);
  await fs.rm(workDir, { recursive: true, force: true });
});
