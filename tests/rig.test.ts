import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCharacterRig,
  resolveAction
} from "../packages/anatomy-engine/src/index.ts";
import { CROW_SVG, UNNAMED_BIRD_SVG } from "../packages/anatomy-engine/src/fixtures.ts";
import type { SceneArtboard } from "../packages/scene-graph/src/index.ts";

const QUADRUPED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180">
  <g id="tail"><path d="M40 90 L10 70 L14 100 Z"/></g>
  <g id="leg-front-left"><rect x="70" y="130" width="12" height="44"/></g>
  <g id="leg-front-right"><rect x="104" y="130" width="12" height="44"/></g>
  <g id="leg-back-left"><rect x="150" y="130" width="12" height="44"/></g>
  <g id="leg-back-right"><rect x="184" y="130" width="12" height="44"/></g>
  <ellipse id="body" cx="120" cy="105" rx="72" ry="38"/>
  <g id="head">
    <circle cx="196" cy="66" r="26"/>
    <circle id="eye-left" cx="190" cy="60" r="4"/>
    <circle id="eye-right" cx="204" cy="60" r="4"/>
    <polygon id="beak" points="220,62 236,68 220,74"/>
  </g>
</svg>`;

const VEHICLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 160">
  <rect id="chassis" x="30" y="60" width="200" height="52" rx="12"/>
  <g id="cab"><path d="M70 60 L92 24 L164 24 L186 60 Z"/></g>
  <g id="headlight-left"><circle cx="42" cy="76" r="7"/></g>
  <g id="headlight-right"><circle cx="218" cy="76" r="7"/></g>
  <g id="wheel-front-left"><circle cx="78" cy="118" r="18"/></g>
  <g id="wheel-front-right"><circle cx="112" cy="118" r="18"/></g>
  <g id="wheel-back-left"><circle cx="152" cy="118" r="18"/></g>
  <g id="wheel-back-right"><circle cx="186" cy="118" r="18"/></g>
</svg>`;

const BLOB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <ellipse cx="110" cy="105" rx="54" ry="44"/>
</svg>`;

test("crow rig builds a bone hierarchy with eyes parented to head and a look-at chain", () => {
  const { report, rig, suggestedStates } = buildCharacterRig(CROW_SVG);
  assert.equal(report.manifest.speciesId, "avian-crow");

  const byId = new Map(rig.bones.map((bone) => [bone.boneId, bone]));
  const headBone = rig.bones.find((bone) => bone.name === "head");
  assert.ok(headBone, "head bone exists");
  const eyeBones = rig.bones.filter((bone) => bone.name.startsWith("eyes"));
  assert.equal(eyeBones.length, 2);

  const eyeTargets = new Set(eyeBones.flatMap((bone) => bone.targetParts));
  assert.deepEqual([...eyeTargets].sort(), ["eye-left", "eye-right"]);
  for (const eye of eyeBones) {
    assert.ok(byId.get(eye.parentBoneId ?? ""), "eye parent resolves");
    if (headBone) {
      assert.equal(eye.parentBoneId, headBone.boneId);
    }
  }

  assert.equal(rig.ikChains.length, 1);
  assert.equal(rig.ikChains[0]?.hint, "look-at");
  assert.equal(rig.ikChains[0]?.targetPart, "eye-left");

  const kinds = rig.secondaryMotion.map((entry) => entry.kind);
  assert.ok(kinds.includes("breathe"));
  assert.ok(kinds.includes("blink"));
  assert.ok(kinds.includes("spring"), "tail gets spring secondary motion");
  assert.ok(kinds.includes("sway"), "wings get sway secondary motion");

  assert.ok(suggestedStates.includes("idle-breathe"));
  assert.ok(suggestedStates.includes("active-flap"));
});

test("rig is deterministic for identical input", () => {
  const first = buildCharacterRig(CROW_SVG).rig;
  const second = buildCharacterRig(CROW_SVG).rig;
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test("quadruped schema matches a four-legged character and resolves trot", () => {
  const { report, rig } = buildCharacterRig(QUADRUPED_SVG);
  assert.equal(report.ok, true);
  assert.equal(report.manifest.speciesId, "generic-quadruped");

  const trot = resolveAction(report, "trot");
  assert.equal(trot.ok, true);
  const legNodes = [...new Set(trot.steps.flatMap((step) => step.nodeIds))].sort();
  assert.deepEqual(legNodes, [
    "leg-back-left",
    "leg-back-right",
    "leg-front-left",
    "leg-front-right"
  ]);

  const wheelishBones = rig.bones.filter((bone) => bone.name.startsWith("leg"));
  assert.equal(wheelishBones.length, 4);
});

test("vehicle schema detects chassis, cab, headlights, and wheels; roll resolves to wheels", () => {
  const { report, suggestedStates } = buildCharacterRig(VEHICLE_SVG);
  assert.equal(report.ok, true);
  assert.equal(report.manifest.speciesId, "vehicle");
  const roles = report.parts.map((part) => `${part.role}:${part.nodeId}`);
  assert.ok(roles.some((entry) => entry.startsWith("wheel:wheel-front-left")));
  assert.ok(roles.some((entry) => entry.startsWith("eyes:headlight")));
  assert.ok(roles.some((entry) => entry.startsWith("body:chassis")));

  const roll = resolveAction(report, "roll");
  assert.equal(roll.ok, true);
  assert.equal(roll.steps[0]?.controller, "rotate");
  assert.ok(suggestedStates.includes("active-move"));
});

test("unnamed blob still receives a universal rig with breathe life", () => {
  const { rig, suggestedStates } = buildCharacterRig(BLOB_SVG);
  assert.equal(rig.speciesId, "blob");
  assert.ok(rig.bones.length >= 1, "root bone always exists");
  assert.equal(rig.bones[0]?.name, "root");
  const breathe = rig.secondaryMotion.find((entry) => entry.kind === "breathe");
  assert.ok(breathe, "breathe secondary motion is guaranteed");
  assert.equal(breathe?.periodMs, 3400);
  assert.ok(suggestedStates.includes("error-wobble"));
});

test("fully empty svg still produces a root bone and breathe motion", () => {
  const { rig } = buildCharacterRig(UNNAMED_BIRD_SVG.length > 0 ? "<svg viewBox='0 0 10 10'></svg>" : "");
  assert.ok(rig.bones.length >= 1);
  const target = rig.bones[0]?.targetParts[0];
  assert.equal(target, "*");
  assert.ok(rig.secondaryMotion.some((entry) => entry.kind === "breathe"));
});

test("rig attaches cleanly to a SceneDoc artboard (v1 backward compatible)", () => {
  const { rig } = buildCharacterRig(CROW_SVG);
  const artboard: SceneArtboard = {
    artboardId: "a1",
    name: "crow",
    layers: [],
    clips: {},
    stateMachines: [],
    bindings: [],
    listeners: [],
    audioEvents: [],
    rig
  };
  assert.equal(artboard.rig?.bones.length, rig.bones.length);
  assert.equal(artboard.rig?.ikChains[0]?.hint, "look-at");
});
