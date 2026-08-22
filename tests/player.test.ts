import assert from "node:assert/strict";
import test from "node:test";
import { ScenePlayer, applyFrame, sampleClipFrame } from "../packages/player/src/index.ts";
import type { SceneArtboard, SceneDoc } from "../packages/scene-graph/src/index.ts";

const ARTBOARD: SceneArtboard = {
  artboardId: "ab_test",
  name: "Test",
  layers: [{ layerId: "l1", name: "Main", order: 0, targetParts: ["orb"], initialStateId: "s_idle" }],
  clips: {
    "c_idle": {
      clipId: "c_idle", name: "Idle", durationMs: 1000, loop: true,
      tracks: [{
        targetPart: "*", property: "scale",
        keys: [{ t: 0, value: 1 }, { t: 500, value: 2 }, { t: 1000, value: 1 }]
      }]
    },
    "c_hover": {
      clipId: "c_hover", name: "Hover", durationMs: 200, loop: false,
      tracks: [
        { targetPart: "*", property: "translateY", keys: [{ t: 0, value: 0 }, { t: 200, value: -10 }] },
        { targetPart: "orb", property: "opacity", keys: [{ t: 0, value: 1 }, { t: 200, value: 0.5 }] }
      ]
    },
    "c_done": {
      clipId: "c_done", name: "Done", durationMs: 300, loop: false,
      tracks: [{ targetPart: "*", property: "opacity", keys: [{ t: 0, value: 1, easing: "hold" }, { t: 300, value: 0 }] }]
    }
  },
  stateMachines: [{
    stateMachineId: "sm",
    name: "Main",
    initialStateId: "s_idle",
    states: [
      { stateId: "s_idle", name: "Idle", kind: "entry", clipId: "c_idle", controlledParts: [] },
      { stateId: "s_hover", name: "Hover", kind: "single", clipId: "c_hover", controlledParts: [] },
      { stateId: "s_done", name: "Done", kind: "single", clipId: "c_done", controlledParts: [] }
    ],
    transitions: [
      { transitionId: "t1", fromStateId: "s_idle", toStateId: "s_hover", event: "pointerEnter", durationMs: 200, interpolation: "linear", conditions: [], actions: [] },
      { transitionId: "t2", fromStateId: "*", toStateId: "s_done", event: "success", durationMs: 300, interpolation: "linear", conditions: [], actions: [] }
    ]
  }],
  bindings: [],
  listeners: [],
  audioEvents: []
};

const DOC: SceneDoc = {
  formatVersion: 1,
  sceneId: "s_test",
  name: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  artboards: [ARTBOARD]
};

test("player starts in the initial state and walks the transition graph", () => {
  const player = new ScenePlayer(DOC);
  assert.equal(player.state, "idle");
  assert.equal(player.send("nope"), false);
  assert.equal(player.send("pointerEnter"), true);
  assert.equal(player.state, "hover");
  // wildcard edge lands from any state
  assert.equal(player.send("success"), true);
  assert.equal(player.state, "done");
});

test("seek is deterministic and loops wrap", () => {
  const player = new ScenePlayer(DOC);
  const a = player.seek(250);
  const b = new ScenePlayer(DOC).seek(250);
  assert.deepEqual(a, b);
  // loop wraps at 1250 -> 250
  const wrapped = player.seek(1250);
  assert.equal((wrapped["*"]!.scale as number[] | number), (a["*"]!.scale));
});

test("one-shot clips clamp to their final keyframe", () => {
  const player = new ScenePlayer(DOC);
  player.enterState("hover");
  const frame = player.seek(9999);
  assert.equal(frame["*"]!.translateY, -10);
  assert.equal(frame["orb"]!.opacity, 0.5);
});

test("reduced motion resolves terminal values immediately", () => {
  const reduced = new ScenePlayer(DOC, { reducedMotion: true });
  const frame = reduced.seek(0);
  assert.equal(frame["*"]!.scale, 1, "terminal of idle loop equals last key");
  const held = sampleClipFrame(ARTBOARD.clips["c_done"]!, true);
  assert.equal(held["*"]!.opacity, 0);
});

test("applyFrame patches transforms and opacity into serialized SVG", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="orb"><circle cx="5" cy="5" r="4"/></g></svg>`;
  const out = applyFrame(svg, {
    "*": { translateY: -3 },
    orb: { opacity: 0.5, scale: 1.5 }
  });
  assert.ok(out.includes('transform="translate(0 -3)'), `root wrapper gets wildcard transform`);
  assert.ok(/<g id="orb" [^>]*transform="[^"]*scale\(1\.5/.test(out), `orb scaled`);
  assert.ok(/<g id="orb"[^>]*opacity="0.5"/.test(out), `orb dimmed`);
  // round-trip parses cleanly
  const reparsed = applyFrame(out, {});
  assert.ok(reparsed.includes("<circle"));
});
