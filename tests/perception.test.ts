import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  isGlb,
  parseGltf,
  perceiveImage,
  proposeRigFromGltf,
  proposeRigFromImage
} from "../packages/perception-engine/src/index.ts";

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA8, filter 0 scanlines) — enough for local fixtures
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

function encodeTestPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", new Uint8Array(0))
    ])
  );
}

function blankCanvas(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4).fill(255);
  return rgba;
}

function paintCircle(rgba: Uint8Array, width: number, cx: number, cy: number, r: number, color: [number, number, number]): void {
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const offset = (y * width + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = 255;
    }
  }
}

function paintRect(rgba: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number, color: [number, number, number]): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Image perception
// ---------------------------------------------------------------------------

test("perceiveImage segments distinct paint regions into named SVG parts", () => {
  const size = 64;
  const rgba = blankCanvas(size, size);
  paintCircle(rgba, size, 18, 18, 10, [220, 40, 40]);
  paintRect(rgba, size, 38, 42, 60, 58, [40, 60, 220]);
  const png = encodeTestPng(size, size, rgba);

  const perceived = perceiveImage(png, { maxColors: 6 });

  assert.ok(perceived.parts.length >= 2, `expected >=2 parts, got ${perceived.parts.length}`);
  assert.match(perceived.svg, /id="part-1"/);
  assert.match(perceived.svg, /<path d="M[^"]+" fill="#/);

  const sorted = [...perceived.parts].sort((a, b) => a.centroid.x - b.centroid.x);
  const left = sorted[0]!;
  const right = sorted[sorted.length - 1]!;
  assert.ok(right.centroid.x - left.centroid.x > 12, "regions should be spatially separated");
  assert.ok(perceived.parts.every((part) => part.areaPx >= 24));
});

test("proposeRigFromImage returns a commit-free proposal through the standard auto-rigger", () => {
  const size = 64;
  const rgba = blankCanvas(size, size);
  paintCircle(rgba, size, 20, 20, 12, [200, 50, 50]);
  paintRect(rgba, size, 30, 40, 56, 56, [50, 70, 210]);
  const png = encodeTestPng(size, size, rgba);

  const proposal = proposeRigFromImage(png, { maxColors: 6 });
  assert.equal(proposal.proposalOnly, true);
  assert.equal(proposal.nextTool, "rig_asset");
  assert.ok(proposal.rigBlock.bones.length >= 1, "blob fallback should still emit a bone");
  assert.ok(typeof proposal.speciesId === "string");
  assert.ok(proposal.notes.length >= 1);
});

// ---------------------------------------------------------------------------
// glTF parsing guards
// ---------------------------------------------------------------------------

test("parseGltf rejects binary .glb and pre-2.0 documents", () => {
  const glbMagic = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 0x00, 0x00]);
  assert.equal(isGlb(glbMagic), true);
  assert.throws(() => parseGltf(glbMagic), /\.glb/);
  assert.throws(() => parseGltf(JSON.stringify({ asset: { version: "1.0" } })), /glTF 2\.0/);
});

// ---------------------------------------------------------------------------
// Skinned glTF → exact joint hierarchy
// ---------------------------------------------------------------------------

interface GltfFixtureBuffers {
  json: string;
}

function skinnedGltfFixture(): GltfFixtureBuffers {
  const jointBytes = Buffer.alloc(8);
  jointBytes.writeUInt16LE(0, 0);
  jointBytes.writeUInt16LE(0, 2);
  jointBytes.writeUInt16LE(2, 4);
  jointBytes.writeUInt16LE(0, 6);
  const weightBytes = Buffer.alloc(16);
  weightBytes.writeFloatLE(0.5, 0);
  weightBytes.writeFloatLE(0.0, 4);
  weightBytes.writeFloatLE(0.5, 8);
  weightBytes.writeFloatLE(0.0, 12);
  const binary = Buffer.concat([jointBytes, weightBytes]);

  const doc = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "root", translation: [0, 0, 0], children: [1] },
      { name: "spine", translation: [0, 0.5, 0], children: [2] },
      { name: "head", translation: [1, 1, 0] }
    ],
    skins: [{ name: "body", joints: [0, 1, 2] }],
    meshes: [{ primitives: [{ attributes: { JOINTS_0: 0, WEIGHTS_0: 1 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5123, count: 1, type: "VEC4" },
      { bufferView: 1, componentType: 5126, count: 1, type: "VEC4" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 },
      { buffer: 0, byteOffset: 8, byteLength: 16 }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${binary.toString("base64")}`, byteLength: binary.length }]
  };
  return { json: JSON.stringify(doc) };
}

test("skinned glTF yields the file's exact joint hierarchy with projected origins", async () => {
  const proposal = await proposeRigFromGltf(skinnedGltfFixture().json);

  assert.equal(proposal.proposalOnly, true);
  assert.equal(proposal.source, "skin");
  assert.equal(proposal.boneCount, 3);

  const bones = proposal.rigBlock.bones;
  assert.deepEqual(bones.map((bone) => bone.name), ["root", "spine", "head"]);
  assert.equal(bones[0]!.parentBoneId, undefined);
  assert.equal(bones[1]!.parentBoneId, bones[0]!.boneId);
  assert.equal(bones[2]!.parentBoneId, bones[1]!.boneId);

  assert.equal(proposal.weightSummary?.bone_0?.influences, 1);
  assert.equal(proposal.weightSummary?.bone_2?.maxWeight, 0.5);
});

// ---------------------------------------------------------------------------
// Unskinned glTF → inferred band chain along dominant axis
// ---------------------------------------------------------------------------

function unskinnedGltfFixture(): string {
  const positions: number[] = [];
  for (let i = 0; i < 25; i += 1) {
    const t = i / 24;
    positions.push(Math.sin(t * Math.PI) * 0.1, t * 3, 0);
  }
  const binary = Buffer.alloc(positions.length * 4);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));

  return JSON.stringify({
    asset: { version: "2.0" },
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 25, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.length }],
    buffers: [{ uri: `data:application/octet-stream;base64,${binary.toString("base64")}`, byteLength: binary.length }]
  });
}

test("unskinned glTF infers a parent-chained band skeleton along the longest axis", async () => {
  const proposal = await proposeRigFromGltf(unskinnedGltfFixture(), { bands: 5 });

  assert.equal(proposal.source, "mesh-inference");
  assert.equal(proposal.boneCount, 5);
  const bones = proposal.rigBlock.bones;
  assert.equal(bones[0]!.parentBoneId, undefined);
  for (let i = 1; i < bones.length; i += 1) {
    assert.equal(bones[i]!.parentBoneId, bones[i - 1]!.boneId);
  }

  const ys = bones.map((bone) => bone.origin.y);
  for (let i = 1; i < ys.length; i += 1) {
    assert.ok(ys[i]! < ys[i - 1]!, `band centroids should descend after y-flip (${ys[i]} vs ${ys[i - 1]})`);
  }
  assert.ok(proposal.notes.some((note) => note.includes("INFERRED")));
});
