import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { colorToHex, quantizeFrame } from "../packages/vectorizer/src/quantize.ts";
import { simplifyLoop, traceColorMask } from "../packages/vectorizer/src/trace.ts";
import { vectorizeFrames } from "../packages/vectorizer/src/flipbook.ts";
import { splitPngStream } from "../packages/vectorizer/src/extract.ts";
import { hasFfmpeg } from "../packages/capture/src/video.ts";
import { renderSceneFrames } from "../packages/capture/src/capture.ts";

// ---------------------------------------------------------------------------
// Minimal RGBA PNG encoder (store/deflate) so tests can synthesize frames.
// ---------------------------------------------------------------------------

let crcTable: number[] | undefined;
function crc32(buffer: Uint8Array): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePngRgba(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", new Uint8Array(deflateSync(raw))),
      chunk("IEND", new Uint8Array(0))
    ])
  );
}

function solidFrame(
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
  return rgba;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("median-cut quantization finds the dominant flat colors deterministically", () => {
  const size = 16;
  const rgba = solidFrame(size, (x, y) =>
    x < size / 2 && y < size / 2 ? [255, 0, 0] : x >= size / 2 ? [0, 200, 60] : [20, 40, 255]
  );
  const first = quantizeFrame(rgba, size, size, 4);
  const second = quantizeFrame(rgba, size, size, 4);

  assert.equal(first.palette.length, 3, "three distinct flat regions");
  assert.deepEqual(first.palette.map(colorToHex).sort(), ["#00c83c", "#1428ff", "#ff0000"]);
  assert.deepEqual(Array.from(first.indices), Array.from(second.indices), "deterministic mapping");

  assert.equal(first.indices[0], first.indices.find((entry) => entry !== 255), "top-left is red family");
});

test("boundary tracing yields one closed clockwise loop around a rectangle", () => {
  const w = 6;
  const h = 5;
  const mask = new Uint8Array(w * h);
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 2; x <= 4; x += 1) mask[y * w + x] = 1;
  }
  const loops = traceColorMask(mask, w, h);
  assert.equal(loops.length, 1);
  const loop = loops[0]!;
  // Rectangle corners after simplification.
  const simplified = simplifyLoop(loop, 0.5);
  const coords = simplified.map((point) => `${point.x},${point.y}`);
  assert.ok(coords.includes("2,1"), "top-left corner present");
  assert.ok(coords.includes("5,1"), "top-right corner present");
  assert.ok(coords.includes("5,4"), "bottom-right corner present");
  assert.ok(coords.includes("2,4"), "bottom-left corner present");

  // Clockwise winding in y-down space: signed area positive by shoelace convention here
  let sum = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  assert.ok(sum > 0, `outer loop winds consistently (signed area ${sum})`);
});

test("a hole in a region traces as its own counter-winding loop", () => {
  const w = 8;
  const h = 8;
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < 7; y += 1) {
    for (let x = 1; x < 7; x += 1) mask[y * w + x] = 1;
  }
  mask[3 * w + 3] = 0;
  mask[3 * w + 4] = 0;
  mask[4 * w + 3] = 0;
  mask[4 * w + 4] = 0;
  const loops = traceColorMask(mask, w, h);
  assert.equal(loops.length, 2, "outer boundary plus hole");

  let positive = 0;
  let negative = 0;
  for (const loop of loops) {
    let sum = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      sum += a.x * b.y - b.x * a.y;
    }
    if (sum > 0) positive += 1;
    else negative += 1;
  }
  assert.equal(positive, 1);
  assert.equal(negative, 1, "hole winds opposite to outer boundary");
});

test("flipbook pipeline reduces duplicate frames and emits a playable SceneDoc", async () => {
  const size = 12;
  const frameA = solidFrame(size, (x, y) => (x < size / 2 ? [230, 40, 40] : [30, 30, 220]));
  const frameB = solidFrame(size, (x) => (x > size - 6 ? [230, 40, 40] : [30, 30, 220]));
  const pngs = [
    encodePngRgba(frameA, size, size),
    encodePngRgba(frameA, size, size),
    encodePngRgba(frameB, size, size)
  ];

  const result = vectorizeFrames(pngs, { fps: 10 });
  assert.equal(result.totalFrames, 3);
  assert.equal(result.keptFrames, 2, "identical consecutive frames collapse");
  assert.deepEqual(result.frameTimesMs, [0, 200]);

  const artboard = result.doc.artboards[0]!;
  assert.equal(Object.keys(artboard.clips).length, 1);
  const clip = Object.values(artboard.clips)[0]!;
  assert.equal(clip.loop, true);
  assert.ok(clip.durationMs >= 300, "loop wraps past the last keyframe");

  const machine = artboard.stateMachines[0]!;
  assert.equal(machine.initialStateId, "state-play");
  assert.equal(machine.states[0]?.name, "play");

  assert.match(result.layeredSvg, /<g id="fb0" opacity="1">/);
  assert.match(result.layeredSvg, /<g id="fb1" opacity="0">/);
  assert.match(result.layeredSvg, /fill="#e62828"/);
});

test("png stream splitter recovers every embedded frame", () => {
  const pngA = encodePngRgba(solidFrame(4, () => [255, 255, 255]), 4, 4);
  const pngB = encodePngRgba(solidFrame(4, () => [0, 0, 0]), 4, 4);
  const stream = Buffer.concat([Buffer.from(pngA), Buffer.from(pngB)]);
  const frames = splitPngStream(stream);
  assert.equal(frames.length, 2);
});

test("video roundtrip: frames -> mp4 -> ffmpeg extract -> vector flipbook", { skip: !hasFfmpeg() }, async () => {
  const { assembleVideo } = await import("../packages/capture/src/video.ts");  const size = 24;
  const frameA = solidFrame(size, (x) => (x < size / 2 ? [240, 80, 20] : [15, 15, 60]));
  const frameB = solidFrame(size, (x) => (x > size / 2 ? [240, 80, 20] : [15, 15, 60]));
  // Repeat each frame so the video lasts long enough for fps sampling.
  const video = await assembleVideo({
    frames: [
      ...Array(6).fill(encodePngRgba(frameA, size, size)),
      ...Array(6).fill(encodePngRgba(frameB, size, size))
    ],
    fps: 6,
    format: "mp4"
  });
  assert.ok(video.byteLength > 0);

  const { extractVideoFrames } = await import("../packages/vectorizer/src/extract.ts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "motion-video-"));
  try {
    const videoPath = path.join(dir, "in.mp4");
    await fs.writeFile(videoPath, video);
    const extracted = await extractVideoFrames(videoPath, { fps: 6, hardCap: 48 });
    assert.ok(extracted.length >= 2, `expected extracted frames, got ${extracted.length}`);

    const result = vectorizeFrames(extracted, { fps: 6, maxColors: 8, maxKeyframes: 12 });
    assert.ok(result.keptFrames >= 1);
    assert.ok(result.totalFrames <= 48);
    assert.match(result.layeredSvg, /fill="#/);

    // The produced SceneDoc must be playable through the capture pipeline.
    const doc = result.doc;
    (doc.artboards[0] as { sourceSvg?: string }).sourceSvg = result.layeredSvg;
    const rendered = await renderSceneFrames(doc, { maxFrames: 1 });
    assert.ok(rendered.frames.length === 1);
    assert.ok(rendered.frames[0]!.png.byteLength > 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
