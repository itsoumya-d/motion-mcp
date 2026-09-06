import assert from "node:assert/strict";
import test from "node:test";
import { MockBackend } from "../packages/kimodo-bridge/src/index.ts";
import { motionToArtboard } from "../packages/retargeter/src/index.ts";
import {
  emitThreejsAnimation,
  emitR3fAnimation,
  emitVanillaThreejsAnimation
} from "../packages/emitter-threejs/src/index.ts";

test("emitter-threejs: emits React Three Fiber component from 3D artboard", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("walk forward confidently", { durationMs: 2000, fps: 30 });
  const artboard = motionToArtboard(motion, "HeroCharacter");

  const files = emitR3fAnimation({
    planItem: {
      componentId: "hero-character",
      file: "src/components/HeroCharacter.tsx",
      framework: "r3f",
      runtime: ["threejs-animation"],
      interactionIdea: "Walk cycle on hero character",
      whyItMatters: "Character comes to life",
      suggestedTrigger: "idle",
      premiumScore: 90,
      estimatedCredits: 50,
      complexity: "medium"
    },
    options: { framework: "r3f" },
    scene: artboard
  });

  assert.equal(files.length, 1);
  const file = files[0]!;
  assert.ok(file.path.endsWith(".tsx"), `Path should be .tsx, got ${file.path}`);
  assert.ok(file.content.includes("import * as THREE from \"three\";"));
  assert.ok(file.content.includes("useGLTF"));
  assert.ok(file.content.includes("useAnimations"));
  assert.ok(file.content.includes("THREE.QuaternionKeyframeTrack"));
  assert.ok(file.content.includes("THREE.AnimationClip"));
  assert.ok(file.content.includes("<primitive ref={group} object={scene}"));
});

test("emitter-threejs: emits vanilla Three.js setup module", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("wave hello", { durationMs: 1000, fps: 30 });
  const artboard = motionToArtboard(motion, "WavingCharacter");

  const files = emitVanillaThreejsAnimation({
    planItem: {
      componentId: "wave-char",
      file: "src/three/waving.ts",
      framework: "threejs",
      runtime: ["threejs-animation"],
      interactionIdea: "Wave hello",
      whyItMatters: "Friendly gesture",
      suggestedTrigger: "idle",
      premiumScore: 85,
      estimatedCredits: 50,
      complexity: "medium"
    },
    options: { framework: "threejs" },
    scene: artboard
  });

  assert.equal(files.length, 1);
  const file = files[0]!;
  assert.ok(file.path.endsWith(".ts"));
  assert.ok(file.content.includes("GLTFLoader"));
  assert.ok(file.content.includes("THREE.AnimationMixer"));
  assert.ok(file.content.includes("update(deltaTime: number)"));
  assert.ok(file.content.includes("play(clipName?: string)"));
});

test("emitter-threejs: dispatcher routes according to framework", async () => {
  const backend = new MockBackend();
  const motion = await backend.generate("idle", { durationMs: 1000, fps: 30 });
  const artboard = motionToArtboard(motion, "IdleBot");

  const r3fFiles = emitThreejsAnimation({
    planItem: {
      componentId: "bot",
      file: "Bot.tsx",
      framework: "r3f",
      runtime: ["threejs-animation"],
      interactionIdea: "idle",
      whyItMatters: "ambient",
      suggestedTrigger: "idle",
      premiumScore: 80,
      estimatedCredits: 50,
      complexity: "low"
    },
    options: { framework: "r3f" },
    scene: artboard
  });
  assert.ok(r3fFiles[0]?.path.includes("/r3f/"));

  const vanillaFiles = emitThreejsAnimation({
    planItem: {
      componentId: "bot",
      file: "bot.ts",
      framework: "threejs",
      runtime: ["threejs-animation"],
      interactionIdea: "idle",
      whyItMatters: "ambient",
      suggestedTrigger: "idle",
      premiumScore: 80,
      estimatedCredits: 50,
      complexity: "low"
    },
    options: { framework: "threejs" },
    scene: artboard
  });
  assert.ok(vanillaFiles[0]?.path.includes("/threejs/"));
});
