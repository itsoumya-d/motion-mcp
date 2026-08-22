import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEasing,
  clipFromStateNode,
  compileExperienceToScene,
  sampleSceneTrack,
  sceneClipFromMotionDoc,
  validateSceneDoc
} from "../packages/scene-graph/src/index.ts";
import type { PageStateMachineExperience } from "../packages/shared-types/src/index.ts";

const EXPERIENCE: PageStateMachineExperience = {
  pageId: "page_landing",
  screenId: "screen_home",
  file: "app/page.tsx",
  framework: "next",
  name: "Landing",
  experienceSummary: "Hero CTA with premium hover and success reward.",
  restraintRules: ["one hero moment per page"],
  assetNeeds: ["animated logo mark"],
  viewModel: {
    viewModelId: "vm_landing",
    name: "LandingVM",
    properties: [
      { name: "isLoading", type: "boolean", defaultValue: false, description: "submit in flight", source: "app-state" },
      { name: "progress", type: "number", defaultValue: 0, description: "upload progress", source: "form-state" }
    ]
  },
  layers: [
    {
      layerId: "layer_cta",
      name: "CTA",
      order: 0,
      priority: 1,
      ownedParts: ["cta-glow", "cta-label"],
      initialStateId: "state_idle",
      states: [
        { stateId: "state_idle", name: "Idle", kind: "entry", loop: true, controlledParts: ["cta-glow"], description: "breathing idle", readyForCodegen: true },
        { stateId: "state_hover", name: "Hover", kind: "single", controlledParts: ["cta-glow", "cta-label"], description: "lift", readyForCodegen: true },
        { stateId: "state_pressed", name: "Pressed", kind: "single", controlledParts: ["cta-glow"], description: "depress", readyForCodegen: true },
        { stateId: "state_success", name: "Success", kind: "single", loop: true, controlledParts: ["cta-label"], description: "reward pop", readyForCodegen: true }
      ],
      description: "Primary conversion surface"
    }
  ],
  transitions: [
    {
      transitionId: "tx_1",
      fromStateId: "state_idle",
      toStateId: "state_hover",
      layerId: "layer_cta",
      event: "pointerEnter",
      timing: { durationMs: 180, interpolation: "spring" },
      conditions: [],
      actions: [],
      description: "",
      readyForCodegen: true
    },
    {
      transitionId: "tx_2",
      fromStateId: "state_hover",
      toStateId: "state_pressed",
      layerId: "layer_cta",
      event: "pressIn",
      timing: { durationMs: 80, interpolation: "cubic" },
      conditions: [],
      actions: [],
      description: "",
      readyForCodegen: true
    }
  ],
  listeners: [
    { listenerId: "l1", type: "pointer", event: "click", sends: "activate", description: "" }
  ],
  bindings: [
    { property: "isLoading", targetPart: "cta-label", source: "app-state", description: "disable while loading" }
  ],
  codegen: {
    readyForCodegen: true,
    target: "react",
    supportedFeatures: ["states", "transitions"],
    unsupportedFeatures: []
  }
};

test("compiles an experience into a validated SceneArtboard with real clips", () => {
  const artboard = compileExperienceToScene(EXPERIENCE);
  assert.equal(artboard.artboardId, "page_landing");
  assert.equal(artboard.layers[0].targetParts.includes("cta-glow"), true);
  // every state gets a concrete keyframed clip — no more fixed templates
  const clips = Object.values(artboard.clips);
  assert.equal(clips.length, 4);
  for (const clip of clips) {
    assert.ok(clip.tracks.length > 0, `clip ${clip.clipId} has tracks`);
  }
  const idle = artboard.clips["clip-state_idle"]!;
  assert.equal(idle.loop, true);
  assert.equal(idle.durationMs, 3400);

  const machine = artboard.stateMachines[0]!;
  assert.equal(machine.states.length, 4);
  assert.deepEqual(machine.transitions.map((t) => t.transitionId), ["tx_1", "tx_2"]);
  assert.equal(machine.transitions[0].durationMs, 180);
  assert.equal(machine.transitions[0].interpolation, "spring");
  assert.equal(artboard.bindings[0].property, "isLoading");

  const doc = {
    formatVersion: 1 as const,
    sceneId: "s1",
    name: "landing",
    createdAt: new Date().toISOString(),
    artboards: [artboard]
  };
  const validation = validateSceneDoc(doc);
  assert.deepEqual(validation, { ok: true, errors: [] });
});

test("motion grammar is deterministic per state semantics", () => {
  const a = clipFromStateNode({ ...EXPERIENCE.layers[0].states[3], stateId: "x1" });
  const b = clipFromStateNode({ ...EXPERIENCE.layers[0].states[3], stateId: "x2" });
  assert.deepEqual(a.tracks, b.tracks);
  assert.match(a.name, /success/i);
  // success grammar pops then settles
  const scaleTrack = a.tracks.find((track) => track.property === "scale")!;
  assert.deepEqual(scaleTrack.keys.map((key) => key.value), [1, 1.08, 1]);
});

test("stagger offsets keys per controlled part", () => {
  const pressed = EXPERIENCE.layers[0].states[2]!;
  const multiPart = { ...pressed, controlledParts: ["p1", "p2"] };
  const clip = clipFromStateNode(multiPart);
  const p2Scale = clip.tracks.filter((track) => track.targetPart === "p2")[0]!.keys[0]!;
  const p1Scale = clip.tracks.filter((track) => track.targetPart === "p1")[0]!.keys[0]!;
  assert.equal(p2Scale.t - p1Scale.t > 0, true);
});

test("samples tracks deterministically with easing", () => {
  const track = {
    targetPart: "*",
    property: "scale",
    keys: [
      { t: 0, value: 1 },
      { t: 100, value: 2, easing: "easeOut" as const },
      { t: 200, value: 0, easing: "hold" as const }
    ]
  };
  assert.equal(sampleSceneTrack(track, 0), 1);
  assert.equal(sampleSceneTrack(track, -5), 1);
  assert.equal(sampleSceneTrack(track, 250), 0);
  const midEaseOut = sampleSceneTrack(track, 50) as number;
  assert.ok(midEaseOut > 1.5 && midEaseOut < 2, `easeOut midpoint above linear: ${midEaseOut}`);
  assert.equal(sampleSceneTrack(track, 150), 2, "hold keeps previous value");
  assert.ok(applyEasing(0.5, "spring") > 1, "spring overshoots past 1");
});

test("migrates baked MotionDocs into generic SceneClips", () => {
  const clip = sceneClipFromMotionDoc({
    id: "squat-baked",
    durationMs: 2400,
    loop: true,
    meta: { source: "baked", exercise: "squat" },
    tracks: {
      spine: [[0, 0, 0, 0], [900, 16, 0, 0], [2400, 0, 0, 0]]
    },
    translations: {
      root: [[0, 0, 0, 0], [900, 0, -0.34, 0]]
    }
  });
  assert.equal(clip.clipId, "squat-baked");
  assert.equal(clip.durationMs, 2400);
  const rotation = clip.tracks.find((track) => track.property === "jointRotation")!;
  const mid = sampleSceneTrack(rotation, 450) as number[];
  assert.equal(mid.length, 3);
  assert.ok(mid[0] > 4 && mid[0] < 12, "spine rotation interpolates between keys");
  assert.ok(clip.tracks.some((track) => track.property === "jointTranslation"));
});

test("validateSceneDoc catches broken references", () => {
  const artboard = compileExperienceToScene(EXPERIENCE);
  const brokenMachine = {
    ...artboard.stateMachines[0]!,
    initialStateId: "missing",
    transitions: [
      ...artboard.stateMachines[0]!.transitions,
      {
        transitionId: "bad",
        fromStateId: "nope",
        toStateId: "also-nope",
        durationMs: 100,
        interpolation: "linear" as const,
        conditions: [],
        actions: []
      }
    ]
  };
  const doc = {
    formatVersion: 1 as const,
    sceneId: "s",
    name: "n",
    createdAt: new Date().toISOString(),
    artboards: [{ ...artboard, stateMachines: [brokenMachine] }]
  };
  const result = validateSceneDoc(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("initial state missing")));
  assert.ok(result.errors.some((error) => error.includes("from-state nope")));
});
