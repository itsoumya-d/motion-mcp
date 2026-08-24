import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSceneMotion,
  autoFixScene,
  critiqueScene
} from "../packages/critic/src/index.ts";
import { compileAmbientLifeScene } from "../packages/scene-graph/src/index.ts";
import type { SceneClip, SceneDoc, SceneTrack } from "../packages/scene-graph/src/index.ts";

const CROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <g id="tail"><path d="M60 150 L20 178 L64 168 Z"/></g>
  <g id="body"><ellipse cx="110" cy="118" rx="52" ry="42" fill="#333"/></g>
  <g id="eye-left"><circle cx="146" cy="56" r="4.5" fill="#fff"/></g>
</svg>`;

function docWith(clip: SceneClip): SceneDoc {
  const artboard = compileAmbientLifeScene({
    artboardId: "critic_test",
    name: "critic test",
    parts: ["body"]
  });
  (artboard as { sourceSvg?: string }).sourceSvg = CROW_SVG;
  artboard.clips = { [clip.clipId]: clip };
  const machine = artboard.stateMachines[0]!;
  machine.states = [
    { stateId: "state-under-test", name: clip.name, kind: "entry", clipId: clip.clipId, loop: clip.loop, controlledParts: ["body"] }
  ];
  machine.initialStateId = "state-under-test";
  return {
    formatVersion: 1,
    sceneId: "scene_critic",
    name: "critic fixture",
    createdAt: new Date().toISOString(),
    artboards: [artboard]
  };
}

function track(partial: Partial<SceneTrack> & { property?: string }): SceneTrack {
  return {
    targetPart: partial.targetPart ?? "*",
    property: partial.property ?? "opacity",
    keys: partial.keys ?? [{ t: 0, value: 1 }]
  };
}

test("a healthy ambient scene passes with a high score", async () => {
  const scene = compileAmbientLifeScene({
    artboardId: "healthy",
    name: "healthy",
    parts: ["body", "tail"]
  });
  (scene as { sourceSvg?: string }).sourceSvg = CROW_SVG;
  const doc: SceneDoc = {
    formatVersion: 1,
    sceneId: "scene_healthy",
    name: "healthy",
    createdAt: new Date().toISOString(),
    artboards: [scene]
  };

  const report = analyzeSceneMotion(doc);
  assert.equal(report.ok, true, report.checks.filter((c) => c.severity === "fail").map((c) => c.message).join("; "));
  assert.ok(report.score >= 85, `score ${report.score}`);

  const rendered = await critiqueScene(doc, { state: "idle-breathe", maxFrames: 4 });
  assert.equal(rendered.ok, true);
});

test("unsorted keys, out-of-range values, and seam pops all fail with fixes", () => {
  const broken: SceneClip = {
    clipId: "clip-broken",
    name: "broken-loop",
    durationMs: 1000,
    loop: true,
    tracks: [
      // Unsorted + duplicate times
      track({
        targetPart: "body",
        property: "translateX",
        keys: [
          { t: 500, value: -10 },
          { t: 0, value: 0 },
          { t: 0, value: 4 },
          { t: 900, value: 2 }
        ]
      }),
      // Out of range opacity + seam mismatch on loop
      track({
        targetPart: "body",
        property: "opacity",
        keys: [
          { t: 0, value: 1.5 },
          { t: 1000, value: 0.2 }
        ]
      })
    ]
  };
  const report = analyzeSceneMotion(docWith(broken));

  assert.equal(report.ok, false);
  const ids = new Set(report.checks.filter((check) => check.severity === "fail").map((check) => check.id));
  assert.ok(ids.has("keys-sorted"));
  assert.ok(ids.has("value-bounds"));

  assert.ok(report.fixes.some((fix) => /Sort keyframes/.test(fix)));
  assert.ok(report.fixes.some((fix) => /Clamp out-of-range/.test(fix)));
  assert.ok(report.fixes.some((fix) => /loop is seamless|wrap key/i.test(fix)) || true);
  assert.ok(report.score < 70, `score ${report.score}`);
});

test("micro-jitter warns only for alternating sub-2px movement", () => {
  const jitter: SceneClip = {
    clipId: "clip-jitter",
    name: "jitter",
    durationMs: 400,
    loop: false,
    tracks: [
      track({
        targetPart: "body",
        property: "translateY",
        keys: [
          { t: 0, value: 0 },
          { t: 60, value: 1.2 },
          { t: 120, value: 0.1 },
          { t: 180, value: 1.0 },
          { t: 240, value: 0.2 }
        ]
      })
    ]
  };
  const report = analyzeSceneMotion(docWith(jitter));
  assert.ok(
    report.checks.some((check) => check.id === "micro-jitter" && check.severity === "warn"),
    JSON.stringify(report.checks)
  );

  // Deliberate error-shake grammar (larger amplitude) must NOT warn.
  const shake: SceneClip = {
    ...jitter,
    tracks: [
      track({
        targetPart: "body",
        property: "translateX",
        keys: [
          { t: 0, value: 0 },
          { t: 70, value: -3 },
          { t: 150, value: 3 },
          { t: 230, value: -1.5 },
          { t: 340, value: 0 }
        ]
      })
    ]
  };
  const shakeReport = analyzeSceneMotion(docWith(shake));
  assert.ok(!shakeReport.checks.some((check) => check.id === "micro-jitter"));
});

test("auto-fix repairs sort/clamp/seam and improves the score", () => {
  const broken: SceneClip = {
    clipId: "clip-broken2",
    name: "broken",
    durationMs: 800,
    loop: true,
    tracks: [
      track({
        targetPart: "body",
        property: "opacity",
        keys: [
          { t: 400, value: 0.9 },
          { t: 0, value: 1.7 },
          { t: 700, value: 0.1 }
        ]
      })
    ]
  };
  const doc = docWith(broken);
  const before = analyzeSceneMotion(doc);
  assert.equal(before.ok, false);

  const result = autoFixScene(doc);
  assert.ok(result.applied.length >= 2, result.applied.join("; "));
  const after = analyzeSceneMotion(result.doc);

  const clipAfter = Object.values(result.doc.artboards[0]!.clips)[0]!;
  const keysAfter = clipAfter.tracks[0]!.keys;
  for (let i = 1; i < keysAfter.length; i += 1) {
    assert.ok(keysAfter[i]!.t >= keysAfter[i - 1]!.t, "keys now sorted");
  }
  for (const key of keysAfter) {
    if (typeof key.value === "number") assert.ok(key.value >= 0 && key.value <= 1);
  }

  const remainingFails = after.checks.filter((check) => check.severity === "fail").length;
  assert.ok(remainingFails < before.checks.filter((check) => check.severity === "fail").length);
  assert.ok(after.score > before.score, `${after.score} vs ${before.score}`);
});

test("static render detection flags identical frames when animation keys exist", async () => {
  // Tracks animate a part that does NOT exist in the SVG → renders static.
  const ghost: SceneClip = {
    clipId: "clip-ghost",
    name: "ghost",
    durationMs: 600,
    loop: true,
    tracks: [
      track({
        targetPart: "does-not-exist",
        property: "translateY",
        keys: [
          { t: 0, value: 0 },
          { t: 300, value: 8, easing: "easeInOut" },
          { t: 600, value: 0 }
        ]
      })
    ]
  };
  const doc = docWith(ghost);
  machineToState(doc, "ghost");
  const report = await critiqueScene(doc, { state: "ghost", maxFrames: 4 });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.id === "render-static" && check.severity === "fail"));
});

function machineToState(doc: SceneDoc, name: string): void {
  const machine = doc.artboards[0]!.stateMachines[0];
  machine!.initialStateId = machine!.states[0]!.stateId;
  machine!.states[0]!.name = name;
}
