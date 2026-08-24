import assert from "node:assert/strict";
import test from "node:test";
import { validateSceneDoc } from "../packages/scene-graph/src/index.ts";
import {
  generateMotionFromPrompt,
  parseMotionPrompt,
  synthesizeClip
} from "../packages/generation-engine/src/index.ts";

// ---------------------------------------------------------------------------
// Intent parsing
// ---------------------------------------------------------------------------

test("prompt parsing maps lexicon verbs and modifiers deterministically", () => {
  const bounce = parseMotionPrompt("exaggerated fast bounce");
  assert.equal(bounce.primary.action, "bounce");
  assert.equal(bounce.primary.loop, false);
  assert.equal(bounce.primary.speed, "fast");
  assert.equal(bounce.primary.intensity, "exaggerated");

  const idle = parseMotionPrompt("calm idle breathing");
  assert.equal(idle.primary.action, "pulse");
  assert.equal(idle.primary.loop, true);
  assert.equal(idle.primary.speed, "slow");

  const multi = parseMotionPrompt("slide to the left then shake");
  assert.deepEqual(multi.all.map((intent) => intent.action), ["slide", "shake"]);
  assert.equal(multi.primary.direction, "left");
});

test("unknown verbs fall back to ambient pulse with surfaced tokens", () => {
  const parsed = parseMotionPrompt("frobnicate the widget gently");
  assert.equal(parsed.primary.action, "pulse");
  assert.ok(parsed.unmatchedTokens.includes("frobnicate"));
  const again = parseMotionPrompt("frobnicate the widget gently");
  assert.deepEqual(parsed, again);
});

// ---------------------------------------------------------------------------
// Temperament-driven synthesis
// ---------------------------------------------------------------------------

test("energetic motion runs faster and overshoots; calm motion does neither", () => {
  const energetic = synthesizeClip(
    { action: "bounce", loop: false },
    { temperament: "energetic", part: "*", partIndex: 0 }
  );
  const calm = synthesizeClip(
    { action: "bounce", loop: false },
    { temperament: "calm", part: "*", partIndex: 0 }
  );

  assert.ok(energetic.durationMs < calm.durationMs, `${energetic.durationMs} vs ${calm.durationMs}`);

  const energeticApex = Math.min(
    ...energetic.tracks.find((track) => track.property === "translateY")!.keys.map((key) => key.value as number)
  );
  const calmApex = Math.min(
    ...calm.tracks.find((track) => track.property === "translateY")!.keys.map((key) => key.value as number)
  );
  assert.ok(energeticApex <= -14.2, `expected baked overshoot past -14, found ${energeticApex}`);
  assert.ok(calmApex >= -14.001, `calm should not overshoot, found ${calmApex}`);
});

test("jump synthesizes squash-and-stretch scaled by the weight axis", () => {
  const heavy = synthesizeClip({ action: "jump", loop: false }, { temperament: "heavy", part: "*" });
  const floaty = synthesizeClip(
    { action: "jump", loop: false },
    { temperament: { energy: 0.5, weight: 0.05, warmth: 0.5, precision: 0.5 }, part: "*" }
  );

  const scaleYValues = (clip: typeof heavy) =>
    clip.tracks.find((track) => track.property === "scaleY")!.keys.map((key) => key.value as number);
  const heavySquash = Math.min(...scaleYValues(heavy));
  const floatySquash = Math.min(...scaleYValues(floaty));
  assert.ok(heavySquash < 0.9, `heavy landing should squash, min ${heavySquash}`);
  assert.ok(floatySquash > heavySquash, "low weight should squash less");
  assert.ok(Math.max(...scaleYValues(heavy)) > 1.05, "impact bulge on scaleX/scaleY expected");
});

test("generated clips never ship linear easing", () => {
  for (const action of ["bounce", "spin", "shake", "pulse", "nod", "wave", "jump", "sway", "blink", "slide"] as const) {
    for (const loop of [true, false]) {
      if (action === "spin" && loop) continue;
      const clip = synthesizeClip({ action, loop }, { temperament: "playful", part: "*" });
      for (const track of clip.tracks) {
        for (const entry of track.keys) {
          assert.notEqual(entry.easing, "linear", `${action}/${loop}/${track.property}@${entry.t}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Full generation with self-check
// ---------------------------------------------------------------------------

const PARTS = ["head", "torso", "arm-l", "arm-r"];

function buildDoc(): ReturnType<typeof generateMotionFromPrompt> {
  return generateMotionFromPrompt({
    prompt: "nervous fast shake then calm idle",
    temperament: "nervous",
    parts: PARTS,
    name: "test creature"
  });
}

test("generateMotionFromPrompt ships schema-valid scenes that pass its own critic", () => {
  const result = buildDoc();
  assert.equal(result.selfCheck.schemaValid, true, result.selfCheck.schemaErrors.join("; "));
  assert.equal(
    result.selfCheck.ok,
    true,
    result.selfCheck.checks.filter((check) => check.severity !== "pass").map((check) => check.message).join("; ")
  );

  const independent = validateSceneDoc(result.doc);
  assert.equal(independent.ok, true, independent.errors.join("; "));
});

test("multi-part targets stagger per part index", () => {
  const result = buildDoc();
  const shakeClip = Object.values(result.doc.artboards[0]!.clips).find((clip) => clip.name === "shake")!;
  const firstKeysByPart = new Map<string, number>();
  for (const track of shakeClip.tracks) {
    if (firstKeysByPart.has(track.targetPart)) continue;
    firstKeysByPart.set(track.targetPart, track.keys[0]!.t);
  }
  const offsets = PARTS.map((part) => firstKeysByPart.get(part)!);
  for (let i = 1; i < offsets.length; i += 1) {
    assert.ok(offsets[i]! > offsets[i - 1]!, `stagger should grow per part (${offsets.join(",")})`);
  }
});

test("non-looping prompts get an idle entry state with activate transitions", () => {
  const result = generateMotionFromPrompt({
    prompt: "big jump",
    temperament: "energetic",
    parts: ["body"]
  });
  const machine = result.doc.artboards[0]!.stateMachines[0]!;
  assert.equal(machine.initialStateId, "state_idle");
  const idleState = machine.states.find((state) => state.stateId === "state_idle")!;
  assert.equal(idleState.loop, true);
  assert.ok(
    machine.transitions.some(
      (transition) => transition.fromStateId === "state_idle" && transition.event === "activate"
    )
  );
  assert.ok(result.notes.some((note) => note.includes("idle pulse")));
});

test("spin loops are downgraded to single turns with an explanation", () => {
  const result = generateMotionFromPrompt({ prompt: "spin forever", parts: ["body"] });
  assert.ok(result.notes.some((note) => note.includes("single-turn")));
  const spinState = result.doc.artboards[0]!.stateMachines[0]!.states.find((state) => state.name === "spin")!;
  assert.equal(spinState.loop, false);
});

test("generation is byte-deterministic for identical inputs", () => {
  const a = JSON.stringify(buildDoc().doc);
  const b = JSON.stringify(buildDoc().doc);
  const normalize = (value: string): string =>
    value.replace(/"createdAt":"[^"]+"/g, "").replace(/"sceneId":"[^"]+"/g, "");
  assert.equal(normalize(a), normalize(b));
});
