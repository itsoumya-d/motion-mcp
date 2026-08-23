import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileAmbientLifeScene } from "../packages/scene-graph/src/index.ts";
import { emitReactAnimation } from "../packages/emitter-react/src/index.ts";
import {
  attachStoredBindings,
  eventForProperty,
  loadStoredBindings,
  upsertBinding
} from "../packages/mcp-server/src/bindings.ts";

function sceneWithBindings(bindings: Array<{ property: string; targetPart: string; source: "app-state"; description: string }>) {
  const scene = compileAmbientLifeScene({
    artboardId: "ambient_binding_test",
    name: "binding test",
    parts: ["body", "head"]
  });
  scene.bindings = bindings;
  return scene;
}

const BASE_INPUT = {
  planItem: {
    componentId: "asset_x",
    assetId: "asset_x",
    file: "x.svg",
    framework: "next" as const,
    runtime: ["framer-motion"] as const,
    interactionIdea: "test binding wiring",
    whyItMatters: "",
    suggestedTrigger: "idle" as const,
    premiumScore: 0,
    estimatedCredits: 0,
    complexity: "low" as const
  },
  options: {}
};

test("semantic properties map deterministically to MotionEvents", () => {
  assert.equal(eventForProperty("hasError"), "error");
  assert.equal(eventForProperty("isFailed"), "error");
  assert.equal(eventForProperty("isLoading"), "activate");
  assert.equal(eventForProperty("isSubmitting"), "activate");
  assert.equal(eventForProperty("isSuccess"), "success");
  assert.equal(eventForProperty("completed"), "success");
  assert.equal(eventForProperty("progress"), undefined);
  assert.equal(eventForProperty("count"), undefined);
});

test("emitter generates a typed data prop that drives machine inputs", () => {
  const scene = sceneWithBindings([
    { property: "hasError", targetPart: "*", source: "app-state", description: "" },
    { property: "isLoading", targetPart: "*", source: "app-state", description: "" },
    { property: "isSuccess", targetPart: "*", source: "app-state", description: "" }
  ]);
  const [file] = emitReactAnimation({
    ...BASE_INPUT,
    asset: {
      id: "asset_x",
      path: "x.svg",
      type: "svg",
      dimensions: { width: 100, height: 100, viewBox: "0 0 100 100" }
    },
    scene
  });

  assert.ok(file);
  const code = file!.content;
  assert.match(code, /data\?: \{/);
  assert.match(code, /hasError\?: boolean/);
  assert.match(code, /if \(data\.hasError\) \{ send\("error"\); return; \}/);
  assert.match(code, /if \(data\.isLoading\) \{ send\("activate"\); return; \}/);
  assert.match(code, /if \(data\.isSuccess\) \{ send\("success"\); return; \}/);
  assert.match(code, /send\("reset"\);/);
  assert.match(code, /\[data\?\.hasError, data\?\.isLoading, data\?\.isSuccess, send\]\)/);
});

test("pass-through-only bindings produce typed props without an effect", () => {
  const scene = sceneWithBindings([
    { property: "count", targetPart: "*", source: "app-state", description: "" }
  ]);
  const [file] = emitReactAnimation({ ...BASE_INPUT, scene });
  const code = file!.content;
  assert.match(code, /count\?: boolean/);
  assert.doesNotMatch(code, /useEffect\(\(\) => \{\s*if \(!data\) return;\s*send\(/);
});

test("no bindings keeps the classic prop surface", () => {
  const scene = sceneWithBindings([]);
  const [file] = emitReactAnimation({ ...BASE_INPUT, scene });
  const code = file!.content;
  assert.doesNotMatch(code, /data\?:/);
});

test("bindings persist, upsert by property+part, and attach with dedupe", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motion-bindings-"));
  try {
    await upsertBinding(root, "asset_a", {
      property: "hasError",
      targetPart: "*",
      source: "app-state",
      description: "error shake"
    });
    await upsertBinding(root, "asset_a", {
      property: "isLoading",
      targetPart: "*",
      source: "app-state",
      description: ""
    });
    // Same property again replaces instead of duplicating.
    await upsertBinding(root, "asset_a", {
      property: "hasError",
      targetPart: "*",
      source: "app-state",
      description: "updated"
    });

    const stored = await loadStoredBindings(root, "asset_a");
    assert.equal(stored.length, 2);

    const scene = compileAmbientLifeScene({
      artboardId: "ambient_a",
      name: "a",
      parts: ["body"]
    });
    scene.bindings = [{ property: "isLoading", targetPart: "*", source: "app-state", description: "already present" }];
    await attachStoredBindings(root, "asset_a", scene);
    assert.equal(scene.bindings.length, 2, "stored hasError added, duplicate isLoading skipped");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
