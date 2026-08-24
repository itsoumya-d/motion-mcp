import assert from "node:assert/strict";
import test from "node:test";
import { buildMotionCurves } from "../packages/vectorizer/src/index.ts";

type Sample = {
  partId: string;
  tMs: number;
  centroid: { x: number; y: number };
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  fill?: string;
  loop?: Array<{ x: number; y: number }>;
};

function rectLoop(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}

function sample(
  partId: string,
  tMs: number,
  cx: number,
  cy: number,
  fill = "#ff0000"
): Sample {
  return {
    partId,
    tMs,
    centroid: { x: cx, y: cy },
    bbox: { minX: cx - 10, minY: cy - 10, maxX: cx + 10, maxY: cy + 10 },
    fill,
    loop: rectLoop(cx - 10, cy - 10, cx + 10, cy + 10)
  };
}

test("moving parts become eased translate tracks anchored at their base pose", () => {
  const { tracks, durationMs, partsSvg } = buildMotionCurves([
    {
      partId: "part-01",
      label: "Part 01",
      displacementPx: 12,
      frames: [sample("part-01", 0, 30, 30), sample("part-01", 166, 42, 30)]
    }
  ]);

  assert.equal(durationMs >= 166, true);
  const tx = tracks.find((track) => track.targetPart === "part-01" && track.property === "translateX");
  const ty = tracks.find((track) => track.targetPart === "part-01" && track.property === "translateY");
  assert.ok(tx && ty, "both translate axes emitted");

  assert.deepEqual(
    tx!.keys.map((key) => [key.t, key.value]),
    [[0, 0], [166, 12]],
    "x offsets are relative to the base pose"
  );
  assert.ok(tx!.keys.every((key) => key.easing === "easeInOut"), "segments are eased, not linear");

  // Layer markup: persistent per-part group with base shape + fill.
  assert.match(partsSvg, /<g id="part-01">/);
  assert.match(partsSvg, /fill="#ff0000"/);
});

test("static parts render as layers but emit no translate tracks", () => {
  const { tracks, partsSvg } = buildMotionCurves([
    {
      partId: "part-02",
      label: "Part 02",
      displacementPx: 0,
      frames: [sample("part-02", 0, 50, 50, "#00ff00")]
    }
  ]);

  assert.equal(tracks.length, 0);
  assert.match(partsSvg, /<g id="part-02">/);
});

test("parts without geometry still move via centroid-only tracks", () => {
  const bare = {
    partId: "part-03",
    label: "Part 03",
    displacementPx: 9,
    frames: [
      { partId: "part-03", tMs: 0, centroid: { x: 20, y: 20 }, bbox: { minX: 10, minY: 10, maxX: 30, maxY: 30 } },
      { partId: "part-03", tMs: 83, centroid: { x: 29, y: 20 }, bbox: { minX: 19, minY: 10, maxX: 39, maxY: 30 } }
    ]
  };
  const { tracks, partsSvg } = buildMotionCurves([bare]);
  const tx = tracks.find((track) => track.targetPart === "part-03");
  assert.ok(tx, "centroid-only part still animates");
  assert.doesNotMatch(partsSvg, /part-03/, "no geometry means no layer markup");
});
