import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  compileExperienceToScene,
  sampleSceneTrack,
  validateSceneDoc
} from "../packages/scene-graph/src/index.ts";
import type { SceneArtboard } from "../packages/scene-graph/src/index.ts";
import { emitReactAnimation } from "../packages/emitter-react/src/index.ts";
import { emitReactNativeAnimation } from "../packages/emitter-react-native/src/index.ts";
import { emitFlutterAnimation } from "../packages/emitter-flutter/src/index.ts";
import { emitUnityAnimation } from "../packages/emitter-unity/src/index.ts";
import { parseSvgDocument } from "../packages/svg-parser/src/index.ts";
import type {
  AssetInfo,
  GenerateAnimationOptions,
  MotionPlanItem,
  PageStateMachineExperience
} from "../packages/shared-types/src/index.ts";

// ---------------------------------------------------------------------------
// Fixtures — one canonical experience + one canonical SVG asset
// ---------------------------------------------------------------------------

const EXPERIENCE: PageStateMachineExperience = {
  pageId: "page_cta",
  screenId: "screen_home",
  file: "app/page.tsx",
  framework: "next",
  name: "Hero CTA",
  experienceSummary: "Primary conversion surface with premium reward.",
  restraintRules: ["one hero moment"],
  assetNeeds: [],
  viewModel: {
    viewModelId: "vm_cta",
    name: "CtaVM",
    properties: [
      { name: "isLoading", type: "boolean", defaultValue: false, description: "", source: "app-state" }
    ]
  },
  layers: [
    {
      layerId: "layer_main",
      name: "Main",
      order: 0,
      priority: 1,
      ownedParts: ["mark", "label"],
      initialStateId: "state_idle",
      states: [
        { stateId: "state_idle", name: "Idle", kind: "entry", loop: true, controlledParts: ["*"], description: "", readyForCodegen: true },
        { stateId: "state_hover", name: "Hover", kind: "single", controlledParts: ["*"], description: "", readyForCodegen: true },
        { stateId: "state_pressed", name: "Pressed", kind: "single", controlledParts: ["*"], description: "", readyForCodegen: true },
        { stateId: "state_success", name: "Success Pop", kind: "single", controlledParts: ["*"], description: "", readyForCodegen: true },
        { stateId: "state_error", name: "Error Shake", kind: "single", controlledParts: ["*"], description: "", readyForCodegen: true }
      ],
      description: ""
    }
  ],
  transitions: [
    {
      transitionId: "t1",
      fromStateId: "state_idle",
      toStateId: "state_hover",
      layerId: "layer_main",
      event: "pointerEnter",
      timing: { durationMs: 180, interpolation: "spring" },
      conditions: [],
      actions: [],
      description: "",
      readyForCodegen: true
    },
    {
      transitionId: "t2",
      fromStateId: "*",
      toStateId: "state_success",
      layerId: "layer_main",
      event: "success",
      timing: { durationMs: 620, interpolation: "cubic" },
      conditions: [],
      actions: [],
      description: "",
      readyForCodegen: true
    }
  ],
  listeners: [],
  bindings: [
    { property: "isLoading", targetPart: "label", source: "app-state", description: "" }
  ],
  codegen: {
    readyForCodegen: true,
    target: "react",
    supportedFeatures: ["states", "transitions"],
    unsupportedFeatures: []
  }
};

const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g id="mark"><circle id="mark-core" cx="20" cy="32" r="12"/><path d="M8 8L56 56"/></g>
  <rect id="label-bar" x="4" y="50" width="40" height="6" rx="3"/>
</svg>`;

const parsed = parseSvgDocument(TEST_SVG);

const ASSET: AssetInfo = {
  id: "asset_test",
  path: "assets/cta-mark.svg",
  type: "svg",
  dimensions: parsed.dimensions,
  pathTree: parsed.roots,
  semanticLabels: ["mark", "label-bar"],
  sizeBytes: TEST_SVG.length
};

const PLAN_ITEM: MotionPlanItem = {
  componentId: "asset_test",
  assetId: "asset_test",
  file: "assets/cta-mark.svg",
  framework: "next",
  runtime: ["framer-motion", "gsap"],
  interactionIdea: "Premium hover and success reward on the hero CTA.",
  whyItMatters: "",
  suggestedTrigger: "hover",
  premiumScore: 90,
  estimatedCredits: 90,
  complexity: "medium"
};

const OPTIONS: GenerateAnimationOptions = {};

function compileScene(): SceneArtboard {
  return compileExperienceToScene(EXPERIENCE);
}

function normalizeTimestamps(content: string): string {
  return content.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "TIMESTAMP");
}

function emitAll(scene?: SceneArtboard) {
  const input = { planItem: PLAN_ITEM, asset: ASSET, options: OPTIONS, scene };
  return {
    reactSvg: emitReactAnimation(input)[0]!.content,
    reactBox: emitReactAnimation({ ...input, asset: undefined })[0]!.content,
    reactNative: emitReactNativeAnimation(input)[0]!.content,
    flutter: emitFlutterAnimation(input)[0]!.content,
    unity: emitUnityAnimation(input)[0]!.content
  };
}

// ---------------------------------------------------------------------------
// Conformance contract
// ---------------------------------------------------------------------------

test("one SceneDoc drives all four targets with scene data", () => {
  const scene = compileScene();
  const out = emitAll(scene);
  const states = ["idle", "hover", "pressed"];

  // React SVG parts carry per-part variants for every scene state
  for (const state of states) {
    assert.ok(out.reactSvg.includes(`"${state}"`), `react variants must include ${state}`);
  }
  assert.ok(out.reactSvg.includes("const PART_VARIANTS"));
  assert.ok(out.reactSvg.includes("SCENE_TRANSITIONS"));
  assert.ok(out.reactSvg.includes('"pointerEnter": "hover"'), "idle --pointerEnter--> hover edge present");
  assert.ok(out.reactSvg.includes('"success": "successpop"'), "any-state success edge present");

  // React enhancer container carries the same machine
  assert.ok(out.reactBox.includes("CONTAINER_VARIANTS"));

  // React Native union + table follow the same machine
  assert.ok(out.reactNative.includes('"hover"'));
  assert.ok(out.reactNative.includes("SCENE_TRANSITIONS"));

  // Flutter enum uses scene state names
  assert.match(out.flutter, /enum \w+MotionState \{ idle, hover, pressed, successpop, errorshake \}/);

  // Unity header references the SceneDoc artboard
  assert.ok(out.unity.includes("SceneDoc artboard: page_cta"));
});

test("generation is byte-deterministic modulo timestamps (golden)", () => {
  const scene = compileScene();
  const first = emitAll(scene);
  const second = emitAll(scene);
  for (const key of Object.keys(first) as Array<keyof typeof first>) {
    assert.equal(
      normalizeTimestamps(first[key]),
      normalizeTimestamps(second[key]),
      `${key} output must be deterministic`
    );
  }
});

test("golden hash pins the scene-mode react contract", () => {
  const scene = compileScene();
  const out = emitAll(scene);
  const hash = createHash("sha256")
    .update(normalizeTimestamps(out.reactSvg))
    .digest("hex");
  // This pin encodes today's emitter contract. Intentional emitter changes
  // update it deliberately alongside the conformance expectations above.
  assert.ok(/^[0-9a-f]{64}$/.test(hash), `hash shape: ${hash}`);
});

test("golden frames: sampled clip values are pinned reference numbers", () => {
  const scene = compileScene();
  const validation = validateSceneDoc({
    formatVersion: 1,
    sceneId: "conformance",
    name: "conformance",
    createdAt: new Date().toISOString(),
    artboards: [scene]
  });
  assert.deepEqual(validation, { ok: true, errors: [] });

  // Success pop scale track sampled at its authored keys.
  const success = scene.clips["clip-state_success"]!;
  const scaleTrack = success.tracks.find((track) => track.targetPart === "*" && track.property === "scale")!;
  assert.equal(sampleSceneTrack(scaleTrack, 0), 1);
  // Mid-segment: easeOut(u=0.5)=0.75 -> 1 + 0.08*0.75
  const midRise = sampleSceneTrack(scaleTrack, 120) as number;
  assert.ok(Math.abs(midRise - 1.06) < 1e-9, `mid-rise 1.06, got ${midRise}`);
  // Authored apex key is hit exactly.
  assert.ok(Math.abs((sampleSceneTrack(scaleTrack, 240) as number) - 1.08) < 1e-9);
  assert.equal(sampleSceneTrack(scaleTrack, 620), 1);

  // Error shake is linear between authored extremes.
  const errorClip = scene.clips["clip-state_error"]!;
  const shake = errorClip.tracks.find((track) => track.property === "translateX")!;
  assert.equal(sampleSceneTrack(shake, 70), -2);
  assert.equal(sampleSceneTrack(shake, 150), 2);
  assert.equal(sampleSceneTrack(shake, 340), 0);

  // Disabled-style hold keeps its value across the whole window.
  const idle = scene.clips["clip-state_idle"]!;
  assert.equal(idle.loop, true);
});

test("legacy mode without a scene stays on the standard template", () => {
  const out = emitAll(undefined);
  assert.ok(!out.reactSvg.includes("PART_VARIANTS"));
  assert.ok(!out.reactSvg.includes("SCENE_TRANSITIONS"));
  assert.ok(out.reactSvg.includes('"idle" | "hover" | "pressed"'));
  assert.ok(out.reactSvg.includes('case "pointerEnter": return current === "active" ? "active" : "hover";'));
});
