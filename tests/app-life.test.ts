import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileAmbientLifeScene } from "../packages/scene-graph/src/index.ts";
import { animateAppLife } from "../packages/mcp-server/src/app-life.ts";

const CROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <g id="tail"><path d="M60 150 L20 178 L64 168 Z"/></g>
  <g id="leg-left"><rect x="96" y="158" width="7" height="34"/></g>
  <g id="leg-right"><rect x="116" y="158" width="7" height="34"/></g>
  <g id="body"><ellipse cx="110" cy="118" rx="52" ry="42"/></g>
  <g id="wing-left"><path d="M74 96 Q40 104 46 132 Q66 140 88 124 Z"/></g>
  <g id="wing-right"><path d="M146 96 Q180 104 174 132 Q154 140 132 124 Z"/></g>
  <g id="head">
    <circle cx="152" cy="62" r="26"/>
    <g id="eye-left"><circle cx="146" cy="56" r="4.5"/></g>
    <g id="eye-right"><circle cx="160" cy="56" r="4.5"/></g>
  </g>
</svg>`;

const BLOB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <ellipse cx="110" cy="105" rx="54" ry="44"/>
</svg>`;

test("ambient artboard compiles grammar clips for idle/hover/press with transitions", () => {
  const scene = compileAmbientLifeScene({
    artboardId: "ambient_a1",
    name: "a1 ambient life",
    parts: ["body", "head", "eye-left", "eye-right"]
  });

  const machine = scene.stateMachines[0]!;
  const stateNames = machine.states.map((state) => state.name);
  assert.deepEqual(stateNames, ["idle-breathe", "hover-lift", "press-squash"]);
  assert.equal(machine.initialStateId, "state-idle");

  const idleClip = Object.values(scene.clips).find((clip) => clip.name === "idle-breathe")!;
  assert.equal(idleClip.loop, true);
  assert.equal(idleClip.durationMs, 3400);

  // Every named part gets staggered tracks per grammar template.
  const hoverTargets = new Set(
    Object.values(scene.clips)
      .find((clip) => clip.name === "hover-lift")!
      .tracks.map((track) => track.targetPart)
  );
  assert.deepEqual([...hoverTargets].sort(), ["body", "eye-left", "eye-right", "head"]);

  const events = machine.transitions.map((transition) => `${transition.fromStateId}->${transition.toStateId}:${transition.event}`);
  assert.ok(events.includes("state-idle->state-hover:pointerEnter"));
  assert.ok(events.includes("state-hover->state-idle:pointerLeave"));
  assert.ok(events.includes("state-idle->state-press:press"));
  assert.ok(events.includes("state-press->state-idle:release"));

  assert.equal(scene.semantics?.reducedMotionSafe, true);
});

test("capabilities extend the ambient state machine (blink/wobble/sparkle)", () => {
  const scene = compileAmbientLifeScene({
    artboardId: "ambient_a2",
    name: "a2",
    parts: [],
    capabilities: ["blink", "wobble", "sparkle"]
  });

  const stateNames = scene.stateMachines[0]!.states.map((state) => state.name);
  assert.ok(stateNames.includes("idle-blink"));
  assert.ok(stateNames.includes("error-shake"));
  assert.ok(stateNames.includes("success-pop"));

  const targets = new Set(scene.layers[0]!.targetParts);
  assert.deepEqual([...targets], ["*"], "empty parts fall back to whole-artboard target");
});

test("ambient compilation is deterministic", () => {
  const spec = {
    artboardId: "ambient_det",
    name: "det",
    parts: ["a", "b"],
    capabilities: ["blink"]
  } as const;
  assert.equal(
    JSON.stringify(compileAmbientLifeScene(spec)),
    JSON.stringify(compileAmbientLifeScene(spec))
  );
});

test("app-life sweep stages one diff covering every indexed svg asset and rigs them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motion-app-life-"));
  try {
    const dot = path.join(root, ".motion-mcp");
    await fs.mkdir(dot, { recursive: true });
    await fs.writeFile(path.join(root, "crow.svg"), CROW_SVG, "utf8");
    await fs.writeFile(path.join(root, "blob.svg"), BLOB_SVG, "utf8");

    const assets = {
      rootPath: root,
      assets: [
        { id: "asset_crow", path: "crow.svg", type: "svg", sizeBytes: CROW_SVG.length },
        { id: "asset_blob", path: "blob.svg", type: "svg", sizeBytes: BLOB_SVG.length }
      ],
      indexPath: path.join(dot, "assets.json"),
      scannedAt: new Date().toISOString(),
      warnings: []
    };
    await fs.writeFile(path.join(dot, "assets.json"), JSON.stringify(assets), "utf8");

    const result = await animateAppLife(root, {});
    assert.equal(result.ok, true, result.summary);
    assert.ok(result.diffId);
    assert.equal(result.animatedCount, 2);

    const crow = result.components.find((component) => component.componentId === "asset_crow")!;
    assert.equal(crow.speciesId, "avian-crow");
    assert.ok(crow.capabilities.includes("flap"));
    assert.equal(crow.rigAttached, true);
    assert.equal(crow.riggedNow, true, "sweep rigs characters that had no rig yet");

    const states = new Set(crow.states);
    assert.ok(states.has("idle-breathe"));
    assert.ok(states.has("hover-lift"));
    assert.ok(states.has("press-squash"));

    const blob = result.components.find((component) => component.componentId === "asset_blob")!;
    assert.equal(blob.speciesId, "blob");

    const diffOnDisk = JSON.parse(
      await fs.readFile(path.join(dot, "diffs", `${result.diffId}.json`), "utf8")
    ) as { componentId: string; files: Array<{ path: string }>; creditsConsumed: number };
    assert.equal(diffOnDisk.componentId, "app-life-sweep");
    assert.equal(diffOnDisk.creditsConsumed, 10);
    assert.ok(diffOnDisk.files.length >= 2, "one generated file per animated component");

    const rigFile = await fs.readFile(path.join(dot, "rigs", "asset_crow.json"), "utf8");
    assert.match(rigFile, /"speciesId":\s*"avian-crow"/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("scope=characters filters low-anatomy assets and reports skips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motion-app-scope-"));
  try {
    const dot = path.join(root, ".motion-mcp");
    await fs.mkdir(dot, { recursive: true });
    await fs.writeFile(path.join(root, "crow.svg"), CROW_SVG, "utf8");
    await fs.writeFile(path.join(root, "blob.svg"), BLOB_SVG, "utf8");

    const assets = {
      rootPath: root,
      assets: [
        { id: "asset_crow", path: "crow.svg", type: "svg" },
        { id: "asset_blob", path: "blob.svg", type: "svg" }
      ],
      indexPath: path.join(dot, "assets.json"),
      scannedAt: new Date().toISOString(),
      warnings: []
    };
    await fs.writeFile(path.join(dot, "assets.json"), JSON.stringify(assets), "utf8");

    const result = await animateAppLife(root, { scope: "characters" });
    assert.equal(result.animatedCount, 1);
    assert.deepEqual(
      result.components.map((component) => component.componentId),
      ["asset_crow"]
    );
    assert.ok(result.skipped.some((skip) => skip.componentId === "asset_blob"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("sweep without an asset index returns a helpful no-op result", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motion-app-empty-"));
  try {
    const result = await animateAppLife(root, {});
    assert.equal(result.ok, false);
    assert.match(result.summary, /scan_assets/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
