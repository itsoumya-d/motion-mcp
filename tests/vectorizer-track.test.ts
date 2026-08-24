import assert from "node:assert/strict";
import test from "node:test";
import { trackPartsAcrossFrames } from "../packages/vectorizer/src/index.ts";

type Pt = { x: number; y: number };

/** Axis-aligned rectangular loop (clockwise, like traceColorMask output). */
function rectLoop(minX: number, minY: number, maxX: number, maxY: number): Pt[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}

test("tracker keeps part identity across translated frames", () => {
  const frames = [
    { tMs: 0, loops: [rectLoop(10, 10, 30, 30), rectLoop(40, 10, 60, 30)] },
    { tMs: 83, loops: [rectLoop(18, 10, 38, 30), rectLoop(40, 10, 60, 30)] }
  ];

  const result = trackPartsAcrossFrames(frames, { canvas: { width: 64, height: 64 } });

  assert.equal(result.parts.length, 2, "two distinct parts tracked");
  assert.ok(
    result.parts.every((part) => part.frames.length === 2),
    "both parts get a sample in every frame"
  );

  const moving = result.parts.find((part) => part.displacementPx >= 8);
  assert.ok(moving, "the translated square is the mover");

  // Identity holds: one continuous part crosses from original to translated spot.
  assert.equal(moving!.frames[0]!.centroid.x < 25, true, "first sample near original position");
  assert.equal(moving!.frames[1]!.centroid.x > 25, true, "second sample near translated position");

  const stationary = result.parts.find((part) => part !== moving)!;
  assert.equal(stationary.frames[0]!.centroid.x, stationary.frames[1]!.centroid.x, "static part never moves");
});

test("tracker opens a new part when a loop appears without a predecessor", () => {
  const frames = [
    { tMs: 0, loops: [rectLoop(10, 10, 30, 30)] },
    { tMs: 83, loops: [rectLoop(10, 10, 30, 30), rectLoop(52, 40, 62, 50)] }
  ];

  const result = trackPartsAcrossFrames(frames, { canvas: { width: 64, height: 64 } });

  assert.equal(result.parts.length, 2, "stationary part plus the newcomer");
  const newcomer = result.parts.find((part) => part.frames.length === 1);
  assert.ok(newcomer, "the unmatched frame-2 loop opens its own part");
  assert.equal(newcomer!.frames[0]!.tMs, 83);
  assert.equal(newcomer!.frames[0]!.bbox.minX, 52, "newcomer sample records the new loop's bbox");
});

test("tracker returns no parts for degenerate input", () => {
  assert.deepEqual(trackPartsAcrossFrames([], { canvas: { width: 64, height: 64 } }).parts, []);
  const emptyLoops = [{ tMs: 0, loops: [] as Pt[] }];
  assert.deepEqual(trackPartsAcrossFrames(emptyLoops, { canvas: { width: 64, height: 64 } }).parts, []);
});
