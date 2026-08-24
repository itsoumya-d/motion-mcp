import assert from "node:assert/strict";
import test from "node:test";
import { encodePng } from "../packages/capture/src/index.ts";
import {
  trackPartsAcrossFrames,
  vectorizeFrames
} from "../packages/vectorizer/src/index.ts";

function solidFramePng(
  size: number,
  paint: (x: number, y: number) => [number, number, number]
): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const [r, g, b] = paint(x, y);
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

test("vectorizeFrames keeps per-frame traces when keepTraces is set", () => {
  const frames = [
    solidFramePng(32, (x) => (x < 16 ? [200, 30, 30] : [30, 120, 240])),
    solidFramePng(32, (x) => (x < 20 ? [200, 30, 30] : [30, 120, 240]))
  ];
  const result = vectorizeFrames(frames, { fps: 12, keepTraces: true });

  assert.ok(result.traces, "traces are retained");
  assert.equal(result.traces!.length >= 2, true, "one trace entry per kept frame");
  assert.ok(
    result.traces!.every((entry) => entry.loops.length > 0),
    "each trace entry carries traced loops"
  );
});

test("flipbook traces feed straight into the tracker", () => {
  const frames = [
    solidFramePng(24, (x) => (x < 12 ? [255, 0, 0] : [0, 0, 255])),
    solidFramePng(24, (x) => (x < 14 ? [255, 0, 0] : [0, 0, 255]))
  ];
  const { traces } = vectorizeFrames(frames, { fps: 12, keepTraces: true });
  const tracked = trackPartsAcrossFrames(traces!, {
    canvas: { width: 24, height: 24 }
  });
  assert.ok(tracked.parts.length >= 2);
});
