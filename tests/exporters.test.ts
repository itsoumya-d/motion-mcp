import assert from "node:assert/strict";
import test from "node:test";
import { compileExperienceToScene } from "../packages/scene-graph/src/index.ts";
import type { SceneDoc } from "../packages/scene-graph/src/index.ts";
import { toAnimatedSvg, toLottie } from "../packages/exporters/src/index.ts";
import { pathToBezier } from "../packages/exporters/src/path-bezier.ts";
import type {
  MotionPlanItem,
  PageStateMachineExperience
} from "../packages/shared-types/src/index.ts";

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle id="orb" cx="24" cy="24" r="10"/>
  <rect id="bar" x="8" y="44" width="40" height="6" rx="3" transform="translate(2 0)"/>
  <path id="arc-path" d="M8 32 A 12 12 0 0 1 32 32 L 32 20 C 36 16 40 16 44 20 Z" fill="#5B7CFA"/>
</svg>`;

const EXPERIENCE: PageStateMachineExperience = {
  pageId: "page_export",
  file: "app/page.tsx",
  framework: "next",
  name: "Export",
  experienceSummary: "",
  restraintRules: [],
  assetNeeds: [],
  viewModel: { viewModelId: "vm", name: "VM", properties: [] },
  layers: [
    {
      layerId: "layer_main",
      name: "Main",
      order: 0,
      priority: 1,
      ownedParts: ["orb", "bar"],
      initialStateId: "state_idle",
      states: [
        { stateId: "state_idle", name: "Idle", kind: "entry", loop: true, controlledParts: ["*"], description: "", readyForCodegen: true },
        { stateId: "state_pop", name: "Success Pop", kind: "single", controlledParts: ["*"], description: "", readyForCodegen: true },
        { stateId: "state_hold", name: "Disabled Hold", kind: "single", controlledParts: ["*"], description: "", readyForCodegen: true }
      ],
      description: ""
    }
  ],
  transitions: [],
  listeners: [],
  bindings: [],
  codegen: { readyForCodegen: true, target: "react", supportedFeatures: [], unsupportedFeatures: [] }
};

function sceneDoc(): SceneDoc {
  const artboard = compileExperienceToScene(EXPERIENCE);
  (artboard as { sourceSvg?: string }).sourceSvg = SOURCE_SVG;
  return {
    formatVersion: 1,
    sceneId: "scene_export",
    name: "export",
    createdAt: "2026-01-01T00:00:00.000Z",
    artboards: [artboard]
  };
}

// ---------------------------------------------------------------------------
// Animated SVG exporter
// ---------------------------------------------------------------------------

test("animated SVG embeds keyframes, root wrapper and reduced-motion guard", () => {
  const out = toAnimatedSvg(sceneDoc(), { state: "Idle" });
  assert.ok(out.includes("@keyframes mcp-"));
  assert.ok(out.includes("<g data-motion-root>"), "wildcard tracks need a root anchor");
  assert.ok(out.includes("prefers-reduced-motion"));
  assert.ok(out.includes('animation:'), "parts receive animation shorthand");
  // source shapes survive into the output
  assert.ok(out.includes('id="orb"'));
});

test("animated SVG output is byte-deterministic", () => {
  const a = toAnimatedSvg(sceneDoc());
  const b = toAnimatedSvg(sceneDoc());
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// Path → bezier converter
// ---------------------------------------------------------------------------

test("quadratic commands elevate to cubic control points at two-thirds", () => {
  const [sub] = pathToBezier("M0 0 Q 6 6 12 0");
  assert.equal(sub.c, false);
  assert.equal(sub.v.length, 2);
  // out tangent of vertex 0 = cp1 - p0 = (0 + 2/3*6, 0 + 2/3*6)
  assert.deepEqual(sub.o[0], [4, 4]);
  // in tangent of vertex 1 = cp2 - p1 = (12 + 2/3*(6-12), 0 + 2/3*(6-0))
  assert.deepEqual(sub.i[1], [-4, 4]);
});

test("arcs split into proper cubic segments and close with Z", () => {
  const [sub] = pathToBezier("M8 32 A 12 12 0 0 1 32 32 Z");
  // 180-degree sweep -> two ≤90° segments -> three vertices
  assert.ok(sub.v.length >= 3, `expected >=3 vertices, got ${sub.v.length}`);
  assert.equal(sub.c, true);
  // tangents are non-trivial on curved joins
  assert.ok(sub.i.some(([x]) => x !== 0) || sub.o.some(([x]) => x !== 0));
});

test("S mirrors the previous cubic control point", () => {
  const [sub] = pathToBezier("M0 0 C 4 4, 8 4, 12 0 S 20 -4, 24 0");
  assert.equal(sub.v.length, 3);
  assert.deepEqual(sub.o[1], [4, -4]);
});

// ---------------------------------------------------------------------------
// Lottie exporter
// ---------------------------------------------------------------------------

test("lottie header matches clip duration and canvas size", () => {
  const doc = sceneDoc();
  const json = toLottie(doc, { state: "Idle", fps: 60 }) as {
    v: string; fr: number; ip: number; op: number; w: number; h: number; layers: unknown[];
  };
  assert.equal(json.v, "5.7.4");
  assert.equal(json.fr, 60);
  // idle grammar is 3400ms -> 204 frames
  assert.equal(json.op, Math.round(3.4 * 60));
  assert.equal(json.w, 64);
  assert.equal(json.h, 64);
  assert.equal(json.layers.length, 3, "one layer per top-level svg child");
});

test("shape kinds map correctly and transforms compose", () => {
  const json = toLottie(sceneDoc(), { state: "Success Pop" }) as {
    layers: Array<{ ind: number; nm?: string; ks?: Record<string, unknown>; shapes?: Array<Record<string, unknown>> }>;
  };
  const types = new Set<string>();
  for (const layer of json.layers) {
    for (const item of layer.shapes ?? []) types.add(String(item.ty));
  }
  for (const expected of ["el", "rc", "sh"]) {
    assert.ok(types.has(expected), `expected ${expected} in ${[...types].join(",")}`);
  }
  // reversed stacking: first svg child (orb) has highest index
  const inds = json.layers.map((layer) => layer.ind).sort((a, b) => b - a);
  assert.deepEqual(inds, [3, 2, 1]);

  // scale keyframes are percentages of the grammar values (1 -> 1.08)
  const orbLayer = json.layers.find((layer) => layer.nm === "orb")!;
  const scale = orbLayer.ks!.s! as { a: number; k: Array<{ s: number[] }> | number[] };
  assert.equal(scale.a, 1);
  const flat = scale.k as Array<{ s: number[] }>;
  assert.equal(flat.at(-1)!.s[0], 100);
  assert.ok(flat.some((frame) => frame.s?.[0] === 108), "pop apex reaches 108%");
});

test("hold easing emits h segments; lottie output is deterministic", () => {
  // Hand-built two-key clip so the hold segment actually spans a range.
  const doc = sceneDoc();
  const artboard = doc.artboards[0]!;
  artboard.clips["clip-hold"] = {
    clipId: "clip-hold",
    name: "hold-test",
    durationMs: 400,
    loop: false,
    tracks: [{
      targetPart: "*",
      property: "opacity",
      keys: [
        { t: 0, value: 1 },
        { t: 400, value: 0.4, easing: "hold" }
      ]
    }]
  };
  artboard.stateMachines[0]!.states.push({
    stateId: "state_holdtest",
    name: "HoldTest",
    kind: "single",
    clipId: "clip-hold",
    controlledParts: []
  });

  const hold = toLottie(doc, { state: "HoldTest" }) as {
    layers: Array<{ ks?: Record<string, unknown> }>;
  };
  const opacity = hold.layers[0]!.ks!.o! as { a: number; k: Array<{ h?: number; s: number[] }> };
  assert.equal(opacity.a, 1);
  assert.equal(opacity.k[0]!.h, 1, "arriving hold easing marks the segment with h:1");
  assert.equal(opacity.k.at(-1)!.s[0], 40, "final opacity lands at 40%");

  const a = JSON.stringify(toLottie(doc));
  const b = JSON.stringify(toLottie(doc));
  assert.equal(a, b);
});
