import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { encodeGif, lzwEncode, decodePng, captureSceneGif } from "../packages/capture/src/index.ts";
import type { SceneDoc } from "../packages/scene-graph/src/index.ts";

// ---------------------------------------------------------------------------
// Test-side PNG writer (independent implementation)
// ---------------------------------------------------------------------------

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let index = 0; index < 4; index += 1) body[index] = type.charCodeAt(index);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body), false);
  return out;
}

function buildPng(width: number, height: number, rows: Array<{ filter: number; pixels: number[][] }>): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  // compression / filter / interlace remain zero

  const channels = 4;
  const stride = width * channels;
  const raw: number[] = [];
  let previous: number[] | null = null;
  for (const row of rows) {
    raw.push(row.filter);
    const flat: number[] = row.pixels.flat();
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? flat[x - channels]! : 0;
      const up = previous ? previous[x]! : 0;
      const upperLeft = previous && x >= channels ? previous[x - channels]! : 0;
      let filtered: number;
      switch (row.filter) {
        case 0: filtered = flat[x]!; break;
        case 1: filtered = flat[x]! - left; break;
        case 2: filtered = flat[x]! - up; break;
        case 3: filtered = flat[x]! - ((left + up) >> 1); break;
        default: {
          const p = left + up - upperLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upperLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
          filtered = flat[x]! - predictor;
        }
      }
      raw.push(((filtered % 256) + 256) % 256);
    }
    previous = flat;
  }

  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Uint8Array.from(raw))),
    chunk("IEND", new Uint8Array(0))
  ]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

test("decodePng reconstructs None/Sub/Up/Paeth filtered scanlines", () => {
  const png = buildPng(2, 3, [
    { filter: 0, pixels: [[255, 0, 0, 255], [0, 255, 0, 255]] },
    { filter: 1, pixels: [[10, 20, 30, 40], [50, 60, 70, 80]] },
    { filter: 2, pixels: [[100, 100, 100, 100], [128, 128, 128, 128]] },
    { filter: 4, pixels: [[200, 10, 60, 255], [0, 0, 0, 255]] }
  ]);
  const decoded = decodePng(png);
  assert.equal(decoded.width, 2);
  assert.deepEqual(
    [...decoded.rgba.subarray(0, 16)],
    [255, 0, 0, 255, 0, 255, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80]
  );
});

// ---------------------------------------------------------------------------
// LZW lossless roundtrip (decoder implemented independently in-test)
// ---------------------------------------------------------------------------

function lzwDecode(stream: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dictionary = new Map<number, number[]>();
  for (let index = 0; index < clear; index += 1) dictionary.set(index, [index]);

  const out: number[] = [];
  let previous: number[] | null = null;
  let bitPosition = 0;
  const totalBits = stream.length * 8;

  while (true) {
    if (bitPosition + codeSize > totalBits) break;
    let code = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      const absolute = bitPosition + bit;
      code |= ((stream[absolute >> 3]! >> (absolute & 7)) & 1) << bit;
    }
    bitPosition += codeSize;

    if (code === clear) {
      dictionary = new Map();
      for (let index = 0; index < clear; index += 1) dictionary.set(index, [index]);
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      previous = null;
      continue;
    }
    if (code === eoi) break;

    let sequence: number[];
    if (dictionary.has(code)) {
      sequence = dictionary.get(code)!;
    } else if (previous) {
      sequence = [...previous, previous[0]!]; // KwKwK
    } else {
      throw new Error(`invalid LZW code ${code}`);
    }
    out.push(...sequence);
    // GIF decoders are one entry behind the encoder, so they adopt the
    // larger code size one entry EARLIER than the encoder does.
    if (previous && next < 4096) {
      dictionary.set(next++, [...previous, sequence[0]!]);
      if (next === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    previous = sequence;
  }
  return out;
}

function makeIndices(pattern: (index: number) => number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) out[index] = pattern(index);
  return out;
}

test("LZW roundtrips simple alternation", () => {
  const original = makeIndices((index) => index % 2, 64);
  const encoded = lzwEncode(original, 2);
  assert.deepEqual(lzwDecode(encoded, 2), [...original]);
});

test("LZW roundtrips through code growth and dictionary reset at 4096", () => {
  // Long runs over 8 colors force the dictionary past 12-bit territory,
  // triggering the encoder's CLEAR + reset path mid-stream.
  const original = makeIndices((index) => {
    const run = Math.floor(index / 37) % 8;
    return index % 97 === 0 ? 0 : run;
  }, 6000);
  const encoded = lzwEncode(original, 3);
  assert.deepEqual(lzwDecode(encoded, 3), [...original]);
});

// ---------------------------------------------------------------------------
// GIF structure
// ---------------------------------------------------------------------------

function solidFrame(r: number, g: number, b: number): Uint8Array {
  const rgba = new Uint8Array(2 * 2 * 4);
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    rgba[pixel] = r; rgba[pixel + 1] = g; rgba[pixel + 2] = b; rgba[pixel + 3] = 255;
  }
  return rgba;
}

test("encodeGif produces spec-shaped GIF89a output", () => {
  const gif = encodeGif([
    { rgba: solidFrame(255, 0, 0), width: 2, height: 2, delayMs: 100 },
    { rgba: solidFrame(0, 200, 40), width: 2, height: 2, delayMs: 120 }
  ]);

  assert.equal(Buffer.from(gif.subarray(0, 6)).toString(), "GIF89a");
  assert.equal(gif[6]! | (gif[7]! << 8), 2, "logical screen width");
  assert.equal(gif[8]! | (gif[9]! << 8), 2, "logical screen height");
  assert.ok(gif[10]! & 0x80, "global color table flag set");

  const text = Buffer.from(gif).toString("latin1");
  assert.ok(text.includes("NETSCAPE2.0"), "looping extension present");

  const graphicControls = gif.reduce(
    (count, byte, index) =>
      byte === 0x21 && gif[index + 1] === 0xf9 ? count + 1 : count,
    0
  );
  assert.equal(graphicControls, 2, "one GCE per frame");
  assert.equal(gif.at(-1), 0x3b, "trailer");
});

// ---------------------------------------------------------------------------
// Full pipeline (requires optional @resvg/resvg-js)
// ---------------------------------------------------------------------------

const CAPTURE_DOC: SceneDoc = (() => {
  const sourceSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
    '<circle id="orb" cx="8" cy="16" r="6" fill="#ff5555"/></svg>';
  return {
    formatVersion: 1 as const,
    sceneId: "scene_capture",
    name: "capture",
    createdAt: "2026-01-01T00:00:00.000Z",
    artboards: [{
      artboardId: "ab",
      name: "Capture",
      layers: [],
      clips: {
        "clip-move": {
          clipId: "clip-move",
          name: "Move",
          durationMs: 400,
          loop: true,
          tracks: [{ targetPart: "*", property: "translateX", keys: [
            { t: 0, value: 0 }, { t: 400, value: 14 }
          ] }]
        }
      },
      stateMachines: [{
        stateMachineId: "sm",
        name: "Main",
        initialStateId: "s_move",
        states: [{ stateId: "s_move", name: "Move", kind: "entry", clipId: "clip-move", controlledParts: [] }],
        transitions: []
      }],
      bindings: [],
      listeners: [],
      audioEvents: []
    }]
  };
})();

(CAPTURE_DOC.artboards[0] as { sourceSvg?: string }).sourceSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
  '<circle id="orb" cx="8" cy="16" r="6" fill="#ff5555"/></svg>';

test("captureSceneGif rasterizes SceneDoc frames end-to-end", async (t) => {
  try {
    await import("@resvg/resvg-js");
  } catch {
    return t.skip("@resvg/resvg-js not installed");
  }
  const result = await captureSceneGif(CAPTURE_DOC, { fps: 10 });
  assert.equal(result.frames, 4, "400ms at 10fps -> 4 frames");
  assert.ok(result.gif.byteLength > 100, "gif carries real payload");
  assert.equal(Buffer.from(result.gif.subarray(0, 6)).toString(), "GIF89a");
});
