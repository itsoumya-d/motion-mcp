import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { SceneDoc } from "../packages/scene-graph/src/index.ts";
import { ensoulAsset } from "../packages/mcp-server/src/ensoul.ts";

const CROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <g id="tail"><path d="M60 150 L20 178 L64 168 Z" fill="#222"/></g>
  <g id="body"><ellipse cx="110" cy="118" rx="52" ry="42" fill="#333"/></g>
  <g id="eye-left"><circle cx="146" cy="56" r="4.5" fill="#fff"/></g>
</svg>`;

async function makeRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

// PNG encoder (RGBA8) — same approach as the perception fixtures.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
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

test("svg path: perceive → generate → verify → preview with staged receipt", { timeout: 240000 }, async () => {
  const root = await makeRoot("ensoul-svg");
  const result = await ensoulAsset(root, {
    svg: CROW_SVG,
    prompt: "playful wave",
    temperament: "playful"
  });

  assert.equal(result.ok, true, JSON.stringify(result.stages, null, 2));
  assert.equal(result.assetKind, "svg");
  const stageNames = result.stages.map((stage) => stage.stage);
  assert.ok(stageNames.includes("perceive"));
  assert.ok(stageNames.includes("generate"));
  assert.ok(stageNames.includes("verify"));
  assert.ok(stageNames.includes("preview"), "raster sources get a GIF preview");
  assert.ok((result.previewGifBase64?.length ?? 0) > 1000);
  assert.equal(result.states?.includes("wave"), true);

  const docPath = path.join(root, result.docPath!);
  const staged = JSON.parse(await fs.readFile(docPath, "utf8")) as SceneDoc;
  assert.equal(staged.formatVersion, 1);
  assert.equal(result.nextTool, "review_animation");
});

test("png path: raster is perceived into parts before generation", { timeout: 240000 }, async () => {
  const root = await makeRoot("ensoul-png");
  const size = 48;
  const rgba = new Uint8Array(size * size * 4).fill(255);
  for (let y = 8; y < 20; y += 1) {
    for (let x = 8; x < 20; x += 1) {
      const offset = (y * size + x) * 4;
      rgba[offset] = 210;
      rgba[offset + 3] = 255;
    }
  }
  for (let y = 28; y < 44; y += 1) {
    for (let x = 26; x < 44; x += 1) {
      const offset = (y * size + x) * 4;
      rgba[offset + 2] = 200;
      rgba[offset + 3] = 255;
    }
  }
  const imagePath = path.join(root, "blob.png");
  await fs.writeFile(imagePath, encodeTestPng(size, size, rgba));

  const result = await ensoulAsset(root, { imagePath, prompt: "gentle pulse" });
  assert.equal(result.ok, true, JSON.stringify(result.stages, null, 2));
  assert.equal(result.assetKind, "raster-image");
  const perceive = result.stages.find((stage) => stage.stage === "perceive")!;
  assert.match(perceive.summary, /paint-region parts/);
  assert.ok(perceive.artifactPath?.endsWith(".rig-proposal.json"));
  const rigProposalExists = await fs.access(path.join(root, perceive.artifactPath!)).then(
    () => true,
    () => false
  );
  assert.equal(rigProposalExists, true);
});

test("repair branch heals a broken injected doc and reports the fixes", { timeout: 240000 }, async () => {
  const root = await makeRoot("ensoul-repair");
  const broken: SceneDoc = {
    formatVersion: 1,
    sceneId: "scene_broken",
    name: "broken",
    createdAt: "2026-08-24T00:00:00.000Z",
    artboards: [
      {
        artboardId: "board",
        name: "board",
        layers: [],
        clips: {
          "clip-broken": {
            clipId: "clip-broken",
            name: "broken",
            durationMs: 600,
            loop: true,
            tracks: [
              {
                targetPart: "*",
                property: "opacity",
                keys: [
                  { t: 300, value: 1.6 },
                  { t: 0, value: 0.9 },
                  { t: 600, value: 0.1 }
                ]
              },
              {
                targetPart: "*",
                property: "scale",
                keys: [
                  { t: 240, value: 1.08, easing: "linear" },
                  { t: 0, value: 1 },
                  { t: 600, value: 1 }
                ]
              }
            ]
          }
        },
        stateMachines: [
          {
            stateMachineId: "sm",
            name: "sm",
            initialStateId: "state-broken",
            states: [{ stateId: "state-broken", name: "broken", kind: "single", clipId: "clip-broken", loop: true, controlledParts: ["*"] }],
            transitions: []
          }
        ],
        bindings: [],
        listeners: [],
        audioEvents: []
      }
    ]
  };

  const result = await ensoulAsset(root, { svg: CROW_SVG, _initialDoc: broken });
  const repair = result.stages.find((stage) => stage.stage === "repair");
  assert.ok(repair, "repair stage should run");
  assert.equal(repair.ok, true, repair.summary);
  assert.match(repair.summary, /mechanical fix/);
  assert.equal(result.nextTool, "review_animation");
  assert.equal(result.previewGifBase64 === undefined, false, "preview uses the repaired doc");
});

test("glTF path: skeleton proposal stages without a raster preview", async () => {
  const root = await makeRoot("ensoul-gltf");
  const positions: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const t = i / 19;
    positions.push(0, t * 2, 0);
  }
  const binary = Buffer.alloc(positions.length * 4);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  const meshPath = path.join(root, "column.gltf");
  await fs.writeFile(
    meshPath,
    JSON.stringify({
      asset: { version: "2.0" },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 20, type: "VEC3" }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.length }],
      buffers: [{ uri: `data:application/octet-stream;base64,${binary.toString("base64")}`, byteLength: binary.length }]
    }),
    "utf8"
  );

  const result = await ensoulAsset(root, { meshPath, prompt: "sway" });
  assert.equal(result.ok, true, JSON.stringify(result.stages, null, 2));
  assert.equal(result.assetKind, "gltf-mesh");
  assert.equal(result.previewGifBase64, undefined);
  assert.ok(result.notes.some((note) => note.includes("no raster preview")));
  assert.equal(result.docPath !== undefined, true);
});
