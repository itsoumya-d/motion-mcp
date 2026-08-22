import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSvgAnatomy,
  hasCapability,
  listSpecies,
  queueAnimation,
  resolveAction
} from "../packages/anatomy-engine/src/index.ts";
import { CROW_SVG, HUMAN_SVG, UNNAMED_BIRD_SVG } from "../packages/anatomy-engine/src/fixtures.ts";

test("named human svg matches the biped schema and resolves blink/wave to its own parts", () => {
  const report = analyzeSvgAnatomy(HUMAN_SVG);
  assert.equal(report.ok, true);
  assert.equal(report.manifest.speciesId, "human-biped");
  assert.ok(report.manifest.matchConfidence > 0.8);
  assert.ok(hasCapability(report, "blink"));
  assert.ok(hasCapability(report, "wave"));
  assert.ok(hasCapability(report, "squat"));

  const blink = resolveAction(report, "blink");
  assert.equal(blink.ok, true);
  assert.deepEqual(blink.steps[0]?.nodeIds.sort(), ["eye-left", "eye-right"]);
  assert.equal(blink.steps[0]?.controller, "scaleY");

  const wave = resolveAction(report, "wave");
  assert.equal(wave.ok, true);
  const waveRoles = new Set(wave.steps.map((step) => step.role));
  assert.deepEqual([...waveRoles], ["arm"]);

  assert.ok(!hasCapability(report, "caw"), "human mouth must not grant the species-gated caw capability");
  const caw = resolveAction(report, "caw");
  assert.equal(caw.ok, false);
});

test("crow schema resolves caw/flap natively and remaps wave to wings plus head", () => {
  const report = analyzeSvgAnatomy(CROW_SVG);
  assert.equal(report.ok, true);
  assert.equal(report.manifest.speciesId, "avian-crow");
  assert.ok(hasCapability(report, "flap"));
  assert.ok(hasCapability(report, "caw"));
  assert.ok(!hasCapability(report, "squat"));

  const wave = resolveAction(report, "wave");
  assert.equal(wave.ok, true);
  const roles = new Set(wave.steps.map((step) => step.role));
  assert.ok(roles.has("wing"));
  assert.ok(roles.has("head"));
  assert.ok(!roles.has("arm"));

  const caw = resolveAction(report, "caw");
  assert.equal(caw.ok, true);
  assert.deepEqual(caw.steps[0]?.nodeIds, ["beak"]);

  const flap = resolveAction(report, "flap");
  assert.equal(flap.ok, true);
  const flapTargets = [...new Set(flap.steps.flatMap((step) => step.nodeIds))].sort();
  assert.deepEqual(flapTargets, ["wing-left", "wing-right"]);
});

test("the same event stream queues per-species output and skips impossible actions", () => {
  const timeline = [
    { action: "blink", atMs: 0 },
    { action: "wave", atMs: 400 },
    { action: "flap", atMs: 900 }
  ];
  const humanQueue = queueAnimation(analyzeSvgAnatomy(HUMAN_SVG), timeline);
  const crowQueue = queueAnimation(analyzeSvgAnatomy(CROW_SVG), timeline);

  assert.equal(humanQueue.speciesId, "human-biped");
  assert.equal(crowQueue.speciesId, "avian-crow");

  const humanActions = humanQueue.events.map((event) => event.action).sort();
  assert.deepEqual(humanActions, ["blink", "wave"]);
  assert.equal(humanQueue.unresolved.length, 1);
  assert.match(humanQueue.unresolved[0]?.reason ?? "", /wing/);

  assert.equal(crowQueue.unresolved.length, 0);
  assert.deepEqual(
    crowQueue.events.map((event) => event.action).sort(),
    ["blink", "flap", "wave"]
  );
  assert.ok(!humanQueue.ok);
  assert.ok(crowQueue.ok);
});

test("unnamed svg still yields geometric detections, a species guess, and blink capability", () => {
  const report = analyzeSvgAnatomy(UNNAMED_BIRD_SVG);
  assert.equal(report.ok, true);
  const geometryParts = report.parts.filter((part) => part.source === "geometry");
  assert.ok(geometryParts.length >= 4, `expected >=4 geometric parts, got ${geometryParts.length}`);
  assert.ok(geometryParts.some((part) => part.role === "eyes"));
  assert.ok(hasCapability(report, "blink"));

  const blink = resolveAction(report, "blink");
  assert.equal(blink.ok, true);
  assert.equal(blink.steps[0]?.nodeIds.length, 2);
});

test("geometry pairing ranks true twins first so the tail never steals a leg", () => {
  const report = analyzeSvgAnatomy(UNNAMED_BIRD_SVG);
  const geometryParts = report.parts.filter((part) => part.source === "geometry");
  const roleCounts = new Map<string, number>();
  for (const part of geometryParts) {
    roleCounts.set(part.role, (roleCounts.get(part.role) ?? 0) + 1);
  }
  assert.equal(roleCounts.get("eyes"), 2);
  assert.equal(roleCounts.get("wing"), 2);
  assert.equal(roleCounts.get("leg"), 2);
  assert.equal(roleCounts.get("tail"), 1);

  const legPairIndexes = new Set(
    geometryParts.filter((part) => part.role === "leg").map((part) => part.pairIndex)
  );
  assert.equal(legPairIndexes.size, 1, "both legs must share one pair index");

  const tailPart = geometryParts.find((part) => part.role === "tail");
  assert.ok(tailPart, "elongated bottom shape should classify as the tail singleton");
});

test("empty input fails gracefully with an explanatory note", () => {
  const report = analyzeSvgAnatomy("");
  assert.equal(report.ok, false);
  assert.equal(report.parts.length, 0);
  assert.equal(report.manifest.capabilities.length, 0);
  const resolved = resolveAction(report, "blink");
  assert.equal(resolved.ok, false);
  assert.ok(resolved.reason && resolved.reason.length > 0);
});

test("species registry is exposed for downstream tooling", () => {
  const species = listSpecies().map((entry) => entry.id);
  assert.ok(species.includes("human-biped"));
  assert.ok(species.includes("avian-crow"));
});
