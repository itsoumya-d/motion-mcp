import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import ts from "typescript";
import { formatDemo, readFixture, runPatchReviewDemo } from "../examples/patch-review/demo.ts";

const cli = fileURLToPath(new URL("../examples/patch-review/demo.ts", import.meta.url));
const tsx = import.meta.resolve("tsx");
const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

test("demo uses the real import and anchor patcher and matches the complete expected fixture", () => {
  const scenarios = runPatchReviewDemo();
  assert.equal(scenarios.length, 5);
  assert.equal(scenarios[0]!.result.changed, true);
  assert.equal(scenarios[1]!.before, scenarios[0]!.result.content);
  assert.equal(scenarios[1]!.result.changed, true);
  assert.equal(scenarios[1]!.result.content, readFixture("after"));
  assert.deepEqual(scenarios[0]!.result.notes, ['added import of MotionCtaMark from "./MotionCtaMark"']);
  assert.deepEqual(scenarios[1]!.result.notes, ['rendered <MotionCtaMark /> after anchor "<PrimaryButton>Buy</PrimaryButton>"']);
});

test("all repeated and guarded operations preserve every input byte", () => {
  const scenarios = runPatchReviewDemo();
  for (const scenario of scenarios.slice(2)) {
    assert.equal(scenario.result.changed, false, scenario.name);
    assert.equal(scenario.result.content, scenario.before, scenario.name);
  }
  assert.deepEqual(scenarios[2]!.result.notes, ["imports already satisfied", "MotionCtaMark is already rendered"]);
  assert.deepEqual(scenarios[3]!.result.notes, ["anchor not found: <MissingAnchor />"]);
  // This records the existing textual guard's limitation, not semantic JSX detection.
  assert.deepEqual(scenarios[4]!.result.notes, ["MotionCtaMark is already rendered"]);
});

test("demo output is deterministic and matches the checked-in transcript", () => {
  const first = formatDemo(runPatchReviewDemo());
  assert.equal(first, formatDemo(runPatchReviewDemo()));
  const transcript = readFileSync(new URL("../examples/patch-review/expected-output.txt", import.meta.url), "utf8");
  assert.equal(first, transcript);
});

test("the transformed fixture remains syntactically parseable TSX", () => {
  const output = ts.transpileModule(runPatchReviewDemo()[1]!.result.content, {
    fileName: "Checkout.tsx",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.deepEqual(output.diagnostics, []);
  // Syntax-only: no module resolution, type checking, runtime execution, or semantic proof.
});

test("CLI works outside the repository and does not modify either fixture", () => {
  const beforeHashes = [sha256(readFixture("before")), sha256(readFixture("after"))];
  const child = spawnSync(process.execPath, ["--import", tsx, cli], {
    cwd: tmpdir(),
    encoding: "utf8"
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  assert.equal(child.stdout, formatDemo(runPatchReviewDemo()));
  assert.deepEqual([sha256(readFixture("before")), sha256(readFixture("after"))], beforeHashes);
});

test("CLI refuses arbitrary project paths or other arguments", () => {
  const child = spawnSync(process.execPath, ["--import", tsx, cli, "unrequested-project.tsx"], { encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /accepts no arguments/);
});
