import assert from "node:assert/strict";
import test from "node:test";
import { verifyExportParity } from "../packages/exporters/src/index.ts";
import type { SceneDoc } from "../packages/scene-graph/src/index.ts";

const CROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200" width="220" height="200">
  <g id="tail"><path d="M60 150 L20 178 L64 168 Z" fill="#222"/></g>
  <g id="body"><ellipse cx="110" cy="118" rx="52" ry="42" fill="#333"/></g>
</svg>`;

function docWith(clip: SceneDoc["artboards"][number]["clips"][string]): SceneDoc {
  return {
    formatVersion: 1,
    sceneId: "scene_parity",
    name: "parity fixture",
    createdAt: new Date().toISOString(),
    artboards: [
      {
        artboardId: "board",
        name: "board",
        layers: [],
        clips: { [clip.clipId]: clip },
        stateMachines: [
          {
            stateMachineId: "sm",
            name: "sm",
            initialStateId: "state-x",
            states: [{ stateId: "state-x", name: "play", kind: "single", clipId: clip.clipId, controlledParts: ["*"] }],
            transitions: []
          }
        ],
        bindings: [],
        listeners: [],
        audioEvents: [],
        sourceSvg: CROW_SVG
      }
    ]
  };
}

const WELL_FORMED_CLIP = {
  clipId: "clip-play",
  name: "play",
  durationMs: 800,
  loop: true,
  tracks: [
    {
      targetPart: "*",
      property: "scale",
      keys: [
        { t: 0, value: 1 },
        { t: 400, value: 1.06, easing: "easeInOut" as const },
        { t: 800, value: 1 }
      ]
    },
    {
      targetPart: "*",
      property: "opacity",
      keys: [
        { t: 0, value: 0.9 },
        { t: 400, value: 1, easing: "easeInOut" as const },
        { t: 800, value: 0.9 }
      ]
    }
  ]
};

test("well-formed exports carry every stop time to both targets", () => {
  const report = verifyExportParity(docWith(WELL_FORMED_CLIP));

  assert.equal(report.ok, true, JSON.stringify(report.targets, null, 2));
  assert.equal(report.score, 100);
  assert.equal(report.state, "play");
  for (const target of report.targets) {
    assert.deepEqual(target.mismatches, [], `${target.target} should be clean`);
    assert.ok(target.expectedStops >= 4);
    assert.ok(target.observedStops >= target.expectedStops - 1);
  }
});

test("scalar-scale-only drift is caught on the Lottie target", () => {
  // The Lottie emitter reads the scalar "scale" track only; scaleX/scaleY
  // tracks are silently dropped there. Parity must flag exactly that.
  const doc = docWith({
    ...WELL_FORMED_CLIP,
    tracks: [
      {
        targetPart: "*",
        property: "scaleX",
        keys: [
          { t: 0, value: 1 },
          { t: 400, value: 1.05, easing: "easeOut" as const },
          { t: 800, value: 1 }
        ]
      }
    ]
  });
  const report = verifyExportParity(doc);

  const lottie = report.targets.find((target) => target.target === "lottie")!;
  assert.equal(lottie.ok, false);
  assert.ok(
    lottie.mismatches.some((mismatch) => mismatch.property === "scale" && mismatch.kind === "missing"),
    JSON.stringify(lottie.mismatches)
  );
  assert.ok(report.score < 100);
});

test("unsupported paint properties are flagged missing per target", () => {
  const doc = docWith({
    ...WELL_FORMED_CLIP,
    tracks: [
      ...WELL_FORMED_CLIP.tracks,
      {
        targetPart: "*",
        property: "pathLength",
        keys: [
          { t: 0, value: 0 },
          { t: 800, value: 1, easing: "easeInOut" as const }
        ]
      }
    ]
  });
  const report = verifyExportParity(doc);

  const svg = report.targets.find((target) => target.target === "animated-svg")!;
  const lottie = report.targets.find((target) => target.target === "lottie")!;
  assert.equal(svg.ok, true, "animated SVG bakes pathLength stops");
  assert.ok(lottie.mismatches.some((mismatch) => mismatch.property === "pathLength"));
});

test("parity is deterministic for identical inputs", () => {
  const doc = docWith(WELL_FORMED_CLIP);
  assert.deepEqual(verifyExportParity(doc), verifyExportParity(doc));
});
