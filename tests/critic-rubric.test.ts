import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_RUBRIC,
  analyzeSceneMotion,
  lintCurves,
  loadRubric,
  mergeRubric,
  type MotionRubric
} from "../packages/critic/src/index.ts";
import type { SceneClip, SceneDoc } from "../packages/scene-graph/src/index.ts";

function docWith(clip: SceneClip): SceneDoc {
  return {
    formatVersion: 1,
    sceneId: "scene_rubric",
    name: "rubric fixture",
    createdAt: new Date().toISOString(),
    artboards: [
      {
        artboardId: "board",
        name: "board",
        layers: [],
        clips: { [clip.clipId]: clip },
        stateMachines: [
          {
            stateMachineId: "sm",
            name: "sm",
            initialStateId: "state-x",
            states: [
              { stateId: "state-x", name: clip.name, kind: "single", clipId: clip.clipId, controlledParts: ["*"] }
            ],
            transitions: []
          }
        ],
        bindings: [],
        listeners: [],
        audioEvents: []
      }
    ]
  };
}

const POP: SceneClip = {
  clipId: "clip-pop",
  name: "pop",
  durationMs: 400,
  loop: false,
  tracks: [
    {
      targetPart: "*",
      property: "scale",
      keys: [
        { t: 0, value: 1 },
        { t: 200, value: 1.2, easing: "easeOut" },
        { t: 400, value: 1, easing: "easeInOut" }
      ]
    }
  ]
};

test("mergeRubric deep-merges nested sections and replaces arrays", () => {
  const merged = mergeRubric(DEFAULT_RUBRIC, {
    scoring: { failPenalty: 40 },
    curveLint: {
      primaryProperties: ["^rotate$"],
      velocityJumpRatio: 3
    }
  });
  assert.equal(merged.scoring.failPenalty, 40);
  assert.equal(merged.scoring.warnPenalty, DEFAULT_RUBRIC.scoring.warnPenalty);
  assert.deepEqual(merged.curveLint.primaryProperties, ["^rotate$"]);
  assert.equal(merged.curveLint.linearEasingMinSpanMs, DEFAULT_RUBRIC.curveLint.linearEasingMinSpanMs);
});

test("loadRubric reads explicit paths and enforces version 1", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rubric-"));
  const file = path.join(dir, "rubric.json");
  await fs.writeFile(file, JSON.stringify({ version: 1, scoring: { warnPenalty: 12 } }), "utf8");
  const loaded = await loadRubric(dir, file);
  assert.equal(loaded.scoring.warnPenalty, 12);
  assert.equal(loaded.scoring.failPenalty, DEFAULT_RUBRIC.scoring.failPenalty);

  await fs.writeFile(file, JSON.stringify({ version: 2 }), "utf8");
  await assert.rejects(() => loadRubric(dir, file), /version/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("custom fail penalties change structural scores", () => {
  const broken = docWith({
    ...POP,
    tracks: [{ targetPart: "*", property: "opacity", keys: [{ t: 0, value: 4 }] }]
  });
  const harsh: MotionRubric = mergeRubric(DEFAULT_RUBRIC, { scoring: { failPenalty: 50 } });
  const defaultReport = analyzeSceneMotion(broken);
  const harshReport = analyzeSceneMotion(broken, harsh);
  assert.equal(defaultReport.score, 75);
  assert.equal(harshReport.score, 50);
});

test("disabled checks emit nothing", () => {
  const jitterClip: SceneClip = {
    clipId: "clip-jitter",
    name: "jittery",
    durationMs: 400,
    loop: false,
    tracks: [
      {
        targetPart: "*",
        property: "translateX",
        keys: [
          { t: 0, value: 0 },
          { t: 60, value: -1 },
          { t: 120, value: 0.8 },
          { t: 180, value: -0.4 },
          { t: 240, value: 0 }
        ]
      }
    ]
  };
  const withJitter = analyzeSceneMotion(docWith(jitterClip));
  assert.ok(withJitter.checks.some((check) => check.id === "micro-jitter"));

  const rubric = mergeRubric(DEFAULT_RUBRIC, {
    checks: { "micro-jitter": { enabled: false } }
  });
  const without = analyzeSceneMotion(docWith(jitterClip), rubric);
  assert.ok(!without.checks.some((check) => check.id === "micro-jitter"));
});

test("severity overrides can escalate warnings into blockers", () => {
  const mechanical: SceneClip = {
    clipId: "clip-mech",
    name: "mechanical",
    durationMs: 500,
    loop: false,
    tracks: [
      {
        targetPart: "*",
        property: "scale",
        keys: [
          { t: 0, value: 1 },
          { t: 250, value: 1.5, easing: "linear" },
          { t: 500, value: 1, easing: "easeInOut" }
        ]
      }
    ]
  };
  const defaultLint = lintCurves(docWith(mechanical));
  assert.ok(defaultLint.checks.some((check) => check.id === "easing-mechanical" && check.severity === "warn"));
  assert.equal(defaultLint.ok, true);

  const rubric = mergeRubric(DEFAULT_RUBRIC, {
    checks: { "easing-mechanical": { severity: "fail" } }
  });
  const escalated = lintCurves(docWith(mechanical), rubric);
  assert.ok(escalated.checks.some((check) => check.id === "easing-mechanical" && check.severity === "fail"));
  assert.equal(escalated.ok, false);
});

test("project bounds rules tighten what counts as out of range", () => {
  const rubric = mergeRubric(DEFAULT_RUBRIC, {
    bounds: [
      { property: "^scale$", min: 0.05, max: 1.05, label: "brand scale ceiling is 1.05" }
    ]
  });
  const report = analyzeSceneMotion(docWith(POP), rubric);
  assert.ok(report.checks.some((check) => check.id === "value-bounds" && /1\.2/.test(check.message)));
});
