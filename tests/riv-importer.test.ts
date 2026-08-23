import assert from "node:assert/strict";
import test from "node:test";
import { importRiv } from "../packages/riv-importer/src/index.ts";
import { toSceneSkeleton } from "../packages/riv-importer/src/skeleton.ts";

// --- Fixture encoder following the public format spec ----------------------

function varuint(value: number): Uint8Array {
  const out: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return Uint8Array.from(out);
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function f32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, value, true);
  return out;
}

function str(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  return concat([varuint(body.length), body]);
}

function concat(chunks: Array<number | Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(typeof chunk === "number" ? Uint8Array.of(chunk) : chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const MAGIC = [0x52, 0x49, 0x56, 0x45]; // "RIVE"

/** ToC: keys [12(uint),16(string),6(bool),15(float),20(color)] */
function toc(): Uint8Array {
  const keys = concat([
    varuint(12), varuint(16), varuint(6), varuint(15), varuint(20), varuint(0)
  ]);
  // 5 properties -> 2 bytes of backing bits: uint,str,uint,float,color
  const bits = Uint8Array.from([0b10000100, 0b00000011]);
  return concat([keys, bits]);
}

function header(): Uint8Array {
  return concat([Uint8Array.from(MAGIC), varuint(7), varuint(1), varuint(42)]);
}

// ---------------------------------------------------------------------------

test("parses header, ToC and object stream per the public spec", () => {
  const bytes = concat([
    header(),
    toc(),
    varuint(2),            // Node
      varuint(12), varuint(7),
      varuint(16), str("Hero"),
      varuint(0),
    varuint(3),            // Shape
      varuint(6), varuint(1),
      varuint(15), f32le(3.5),
      varuint(20), u32le(0xffcc8811),
      varuint(0)
  ]);

  const result = importRiv(bytes);
  assert.equal(result.ok, true);
  assert.deepEqual(result.header, { majorVersion: 7, minorVersion: 1, fileId: 42 });
  assert.deepEqual(
    result.propertyTable.map((entry) => `${entry.key}:${entry.backingTypeName}`),
    ["12:uint", "16:string", "6:uint", "15:float", "20:color"]
  );
  assert.equal(result.objects.length, 2);
  assert.equal(result.objects[0]!.typeName, "Node");
  assert.equal(result.strings[0]?.value, "Hero");

  const shapeProps = result.objects[1]!.properties;
  assert.deepEqual(shapeProps[1]?.value, { kind: "float", value: 3.5 });
  assert.deepEqual(shapeProps[2]?.value, { kind: "color", value: 0xffcc8811 });
  assert.deepEqual(result.typeHistogram, { "2": 1, "3": 1 });
});

test("rejects non-rive fingerprints", () => {
  const result = importRiv(concat([str("NOPE"), varuint(7)]));
  assert.equal(result.ok, false);
  assert.ok(result.warnings[0]?.includes("fingerprint"));
});

test("truncated streams stop cleanly with recovered data", () => {
  const bytes = concat([
    header(),
    toc(),
    varuint(2),
      varuint(16), str("Partial"),
      varuint(12), varuint(9)
    // EOF before terminator / next object
  ]);
  const result = importRiv(bytes);
  assert.equal(result.ok, true, "partial parse still yields usable inventory");
  assert.equal(result.objects.length, 1);
  assert.equal(result.strings[0]?.value, "Partial");
  assert.ok(result.stoppedAtByte !== undefined);
  assert.ok(result.warnings.some((warning) => warning.includes("mid-object")));
});

test("baseline (non-ToC) properties halt parsing instead of corrupting the stream", () => {
  const bytes = concat([
    header(),
    toc(),
    varuint(2),
      varuint(99), varuint(1), // 99 is not declared in the ToC
      varuint(0)
  ]);
  const result = importRiv(bytes);
  assert.equal(result.ok, true, "inventory up to the stop point is returned");
  assert.equal(result.objects.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("not in the ToC")));
  assert.ok(result.stoppedAtByte !== undefined);
});

test("skeleton carries an honest inventory into SceneDoc form", () => {
  const bytes = concat([
    header(),
    toc(),
    varuint(2),
      varuint(16), str("Hero"),
      varuint(0),
    varuint(3),
      varuint(0)
  ]);
  const result = importRiv(bytes);
  const doc = toSceneSkeleton(result, "fallback-name");
  assert.equal(doc.formatVersion, 1);
  assert.match(doc.sceneId, /^scene_riv_42$/);
  const artboard = doc.artboards[0]!;
  assert.equal(artboard.name, "Hero");
  assert.equal(artboard.stateMachines.length, 0, "no fabricated state machines");
  const inventory = (artboard as { rivInventory?: Record<string, unknown> }).rivInventory!;
  assert.equal(inventory.objectCount, 2);
  assert.deepEqual(inventory.strings, ["Hero"]);
});

// ---------------------------------------------------------------------------
// v2 structural extraction using real core type keys
// ---------------------------------------------------------------------------

function tocStructure(): Uint8Array {
  const keys = concat([
    varuint(4), varuint(56), varuint(57), varuint(59),
    varuint(149), varuint(150), varuint(151), varuint(158), varuint(0)
  ]);
  // backing types: str,uint,uint,uint,uint,uint,uint,uint -> bits
  const bytes = Math.ceil(8 / 4);
  const bits = new Uint8Array(bytes);
  const types = [1, 0, 0, 0, 0, 0, 0, 0];
  types.forEach((value, index) => {
    bits[index >> 2]! |= value << ((index % 4) * 2);
  });
  return concat([keys, bits]);
}

const STRUCTURE_BYTES = concat([
  header(),
  tocStructure(),
  varuint(1),                       // Artboard
    varuint(4), str("Hero"),
    varuint(0),
  varuint(31),                      // LinearAnimation (ctx 0)
    varuint(4), str("idle"),
    varuint(56), varuint(60),
    varuint(57), varuint(120),
    varuint(59), varuint(1),
    varuint(0),
  varuint(53),                      // StateMachine (ctx 1)
    varuint(4), str("Main"),
    varuint(0),
  varuint(57),                      // Layer (ctx 2)
    varuint(0),
  varuint(63),                      // EntryState (ctx 3)
    varuint(0),
  varuint(61),                      // AnimationState (ctx 4)
    varuint(149), varuint(0),
    varuint(0),
  varuint(65),                      // StateTransition (ctx 5)
    varuint(150), varuint(3),
    varuint(151), varuint(4),
    varuint(158), varuint(30),
    varuint(0)
]);

test("extracts real artboards, animations and state-machine topology", () => {
  const result = importRiv(STRUCTURE_BYTES);
  assert.equal(result.ok, true);
  assert.equal(result.objects[0]!.typeName, "Artboard");

  const doc = toSceneSkeleton(result);
  assert.equal(doc.artboards.length, 1);
  const artboard = doc.artboards[0]!;
  assert.equal(artboard.name, "Hero");

  const inventory = (artboard as { rivInventory?: Record<string, unknown> }).rivInventory!;
  const animations = inventory.animations as Array<{ name?: string; durationMs?: number }>;
  assert.equal(animations.length, 1);
  assert.equal(animations[0]!.name, "idle");
  assert.equal(animations[0]!.durationMs, 2000); // 120 frames @ 60fps

  // Topology lands as a real SceneStateMachine graph.
  assert.equal(artboard.stateMachines.length, 1);
  const machine = artboard.stateMachines[0]!;
  assert.equal(machine.name, "Main");
  assert.deepEqual(
    machine.states.map((state) => ({ id: state.stateId, kind: state.kind, name: state.name })),
    [
      { id: "riv_3", kind: "entry", name: "entry" },
      { id: "riv_4", kind: "single", name: "idle" }
    ]
  );
  assert.equal(machine.initialStateId, "riv_3");
  assert.equal(machine.transitions.length, 1);
  assert.equal(machine.transitions[0]!.fromStateId, "riv_3");
  assert.equal(machine.transitions[0]!.toStateId, "riv_4");
  // Transition timing converts at the documented 60fps approximation: 30 frames -> 500ms
  assert.equal(machine.transitions[0]!.durationMs, 500);

  // Honest clips: topology without fabricated keyframes.
  assert.deepEqual(Object.keys(artboard.clips), []);
});

test("files without recognizable artboards still produce an inventory fallback", () => {
  const bytes = concat([
    header(),
    toc(),
    varuint(2),
      varuint(16), str("OrphanString"),
      varuint(0)
  ]);
  const result = importRiv(bytes);
  const doc = toSceneSkeleton(result, "fallback-name");
  assert.equal(doc.artboards.length, 1);
  assert.equal(doc.artboards[0]!.name, "OrphanString");
  assert.equal(doc.artboards[0]!.stateMachines.length, 0);
});

// ---------------------------------------------------------------------------
// v3: keyframe + geometry decode — imported files become renderable scenes
// ---------------------------------------------------------------------------

function tocFull(): Uint8Array {
  // [key, backingType] pairs: 1=string 0=uint 2=float 3=color
  const spec: Array<[number, number]> = [
    [4, 1], [5, 0], [7, 2], [8, 2],
    [13, 2], [14, 2], [20, 2], [21, 2], [24, 2], [25, 2], [31, 2], [37, 3],
    [82, 2], [83, 2],
    [51, 0], [52, 0], [53, 0], [56, 0], [57, 0], [59, 0],
    [67, 0], [68, 0], [70, 2],
    [71, 0], [72, 0],
    [84, 2], [85, 2], [86, 2], [87, 2],
    [149, 0], [150, 0], [151, 0], [158, 0]
  ];
  const keys = concat([...spec.map(([key]) => varuint(key)), varuint(0)]);
  const bytes = Math.ceil(spec.length / 4);
  const bits = new Uint8Array(bytes);
  spec.forEach(([, type], index) => {
    bits[index >> 2]! |= type << ((index % 4) * 2);
  });
  return concat([keys, bits]);
}

const DECODE_BYTES = concat([
  header(),
  tocFull(),
  varuint(1),                                  // Artboard
    varuint(4), str("Hero"),
    varuint(7), f32le(100),                    // width
    varuint(8), f32le(100),                    // height
    varuint(0),
  varuint(2),                                  // Node (ctx 0) — animation target
    varuint(0),
  varuint(12),                                 // Path (ctx 1), parent = node
    varuint(5), varuint(0),
    varuint(0),
  varuint(5),                                  // StraightVertex (ctx 2)
    varuint(5), varuint(1),
    varuint(24), f32le(10),
    varuint(25), f32le(10),
    varuint(0),
  varuint(5),                                  // ctx 3
    varuint(5), varuint(1),
    varuint(24), f32le(60),
    varuint(25), f32le(60),
    varuint(0),
  varuint(5),                                  // ctx 4
    varuint(5), varuint(1),
    varuint(24), f32le(60),
    varuint(25), f32le(10),
    varuint(0),
  varuint(18),                                 // SolidColor (ctx 5), child of path
    varuint(5), varuint(1),
    varuint(37), u32le(0xffcc8811),
    varuint(0),
  varuint(31),                                 // LinearAnimation (ctx 6)
    varuint(4), str("move"),
    varuint(56), varuint(60),
    varuint(57), varuint(60),
    varuint(59), varuint(1),
    varuint(0),
  varuint(25),                                 // KeyedObject (ctx 7)
    varuint(51), varuint(0),
    varuint(52), varuint(6),
    varuint(0),
  varuint(26),                                 // KeyedProperty (ctx 8)
    varuint(71), varuint(7),
    varuint(53), varuint(13),
    varuint(0),
  varuint(30),                                 // KeyFrameDouble (ctx 9)
    varuint(72), varuint(8),
    varuint(67), varuint(0),
    varuint(70), f32le(0),
    varuint(0),
  varuint(30),                                 // KeyFrameDouble (ctx 10)
    varuint(72), varuint(8),
    varuint(67), varuint(60),
    varuint(70), f32le(40),
    varuint(0),
  varuint(53),                                 // StateMachine (ctx 11)
    varuint(4), str("Main"),
    varuint(0),
  varuint(57),                                 // Layer (ctx 12)
    varuint(0),
  varuint(63),                                 // EntryState (ctx 13)
    varuint(0),
  varuint(61),                                 // AnimationState (ctx 14)
    varuint(149), varuint(6),
    varuint(0),
  varuint(65),                                 // StateTransition (ctx 15)
    varuint(150), varuint(13),
    varuint(151), varuint(14),
    varuint(158), varuint(30),
    varuint(0),
  varuint(4),                                  // Ellipse (ctx 16), child of node
    varuint(5), varuint(0),
    varuint(20), f32le(30),
    varuint(21), f32le(24),
    varuint(0),
  varuint(7),                                  // Rectangle (ctx 17)
    varuint(5), varuint(0),
    varuint(20), f32le(20),
    varuint(21), f32le(20),
    varuint(31), f32le(6),
    varuint(0),
  varuint(12),                                 // Path (ctx 18) for cubics
    varuint(5), varuint(0),
    varuint(0),
  varuint(35),                                 // CubicMirrored (ctx 19)
    varuint(5), varuint(18),
    varuint(24), f32le(20),
    varuint(25), f32le(80),
    varuint(82), f32le(0),
    varuint(83), f32le(15),
    varuint(0),
  varuint(35),                                 // ctx 20
    varuint(5), varuint(18),
    varuint(24), f32le(45),
    varuint(25), f32le(95),
    varuint(82), f32le(0),
    varuint(83), f32le(15),
    varuint(0),
  varuint(35),                                 // ctx 21
    varuint(5), varuint(18),
    varuint(24), f32le(70),
    varuint(25), f32le(80),
    varuint(82), f32le(0),
    varuint(83), f32le(15),
    varuint(0)
]);

test("decodes geometry into renderable SVG with real fills", () => {
  const result = importRiv(DECODE_BYTES);
  assert.equal(result.ok, true);
  const doc = toSceneSkeleton(result);
  const artboard = doc.artboards[0]!;
  const svg = (artboard as { sourceSvg?: string }).sourceSvg!;
  assert.ok(svg.includes('viewBox="0 0 100 100"'), "artboard width/height become viewBox");
  assert.ok(
    svg.includes('<g id="mcp-1" fill="#cc8811"><path d="M10 10L60 60L60 10Z"/></g>'),
    `triangle decodes with ARGB fill, got: ${svg}`
  );
});

test("decodes keyframes into playable SceneClips wired to state machines", () => {
  const result = importRiv(DECODE_BYTES);
  const doc = toSceneSkeleton(result);
  const artboard = doc.artboards[0]!;

  const clipKeys = Object.keys(artboard.clips);
  assert.deepEqual(clipKeys, ["clip-riv-anim-move"]);
  const clip = artboard.clips["clip-riv-anim-move"]!;
  assert.equal(clip.durationMs, 1000); // 60 frames @ 60fps
  assert.equal(clip.loop, true);

  const track = clip.tracks.find((candidate) => candidate.property === "translateX")!;
  assert.equal(track.targetPart, "mcp-0", "tracks target the keyed object's context id");
  assert.deepEqual(track.keys, [
    { t: 0, value: 0 },
    { t: 1000, value: 40 }
  ]);

  // AnimationState resolves its clip by name — player/capture work end-to-end.
  const machine = artboard.stateMachines[0]!;
  const animState = machine.states.find((state) => state.stateId === "riv_14")!;
  assert.equal(animState.name, "move");
  assert.equal(animState.clipId, "clip-riv-anim-move");
  assert.equal(machine.initialStateId, "riv_13");
});

test("imported .riv scenes flow straight into the capture pipeline", async (t) => {
  try {
    await import("@resvg/resvg-js");
  } catch {
    return t.skip("@resvg/resvg-js not installed");
  }
  const { captureSceneGif } = await import("../packages/capture/src/index.ts");
  const doc = toSceneSkeleton(importRiv(DECODE_BYTES));
  // Decoder already attached sourceSvg + clips — no extra wiring needed.
  const result = await captureSceneGif(doc, { state: "move", fps: 10 });
  assert.equal(result.frames, 10); // 1000ms clip @ 10fps
  assert.equal(Buffer.from(result.gif.subarray(0, 6)).toString(), "GIF89a");
  assert.ok(result.gif.byteLength > 200);
});

test("parametric shapes and mirrored cubic vertices decode into SVG", () => {
  const result = importRiv(DECODE_BYTES);
  const doc = toSceneSkeleton(result);
  const svg = (doc.artboards[0] as { sourceSvg?: string }).sourceSvg!;

  // Ellipse centered on its parent node position (defaults 0,0)
  assert.ok(
    svg.includes('<ellipse cx="0" cy="0" rx="15" ry="12"/>'),
    "ellipse decoded: " + svg
  );
  // Rounded rectangle
  assert.ok(svg.includes('<rect x="-10" y="-10" width="20" height="20" rx="6" ry="6"/>'), "rounded rect");
  // Mirrored cubic handles: collinear opposite directions along rotation 0deg
  assert.ok(
    svg.includes('<path d="M20 80C35 80 30 95 45 95C60 95 55 80 70 80Z"/>'),
    "mirrored cubics: " + svg
  );
});

// --- Gradient paint decoding (B3) -------------------------------------------
// Fabricated RivImportResult graphs — decodeRiv consumes the parsed result
// directly, so official rive-runtime core ids can be exercised without
// hand-encoding binaries.

import { decodeRiv } from "../packages/riv-importer/src/decode.ts";

type Prop = { key: number; value: { kind: string; value: unknown } };

function obj(
  contextId: number,
  typeKey: number,
  properties: Array<[number, unknown, string?]>,
  artboardIndex = 0
): import("../packages/riv-importer/src/importer.ts").RivObject {
  return {
    objectIndex: contextId,
    contextId,
    artboardIndex,
    typeKey,
    properties: properties.map(([key, value, kind]) => ({
      key,
      value: { kind: kind ?? (typeof value === "string" ? "string" : typeof value === "number" ? "float" : "uint"),
        value }
    })) as Prop[]
  };
}

function gradientResult(): import("../packages/riv-importer/src/importer.ts").RivImportResult {
  // ids: 1=artboard 2=shape 3=path 4..5=vertices 6=fill 7=linearGradient 8,9=stops
  const objects = [
    obj(1, 1, [[4, "gradboard", "string"], [7, 200], [8, 120]]),
    obj(2, 3, [[5, -1]]),                       // shape, parent artboard(-1)
    obj(3, 12, [[5, 2]]),                       // path in shape
    obj(4, 5, [[5, 3], [24, 10], [25, 10]]),    // vertex A
    obj(5, 5, [[5, 3], [24, 110], [25, 90]]),   // vertex B
    obj(6, 20, [[5, 2]]),                       // fill on shape
    // LinearGradient(22): startX=0 startY=0 endX=100 endY=100
    obj(7, 22, [[5, 6], [42, 0], [33, 0], [34, 100], [35, 100]]),
    obj(8, 19, [[5, 7], [38, 0xffff0000, "color"], [39, 0]]),
    obj(9, 19, [[5, 7], [38, 0x800000ff, "color"], [39, 1]])
  ];
  return {
    ok: true,
    propertyTable: [],
    objects,
    strings: [],
    typeHistogram: {},
    warnings: []
  };
}

test("linear gradient fills decode into shared defs with sorted stops", () => {
  const [artboard] = decodeRiv(gradientResult());
  const svg = artboard!.sourceSvg;

  assert.match(svg, /<defs><linearGradient id="mcp-grad-7" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">/);
  assert.match(svg, /<stop offset="0" stop-color="#ff0000"/);
  assert.match(svg, /<stop offset="1" stop-color="#0000ff80"/);
  assert.match(svg, /<\/linearGradient><\/defs>/);
  assert.match(svg, /<g id="mcp-3"[^>]*fill="url\(#mcp-grad-7\)"/);
});

test("radial gradients derive radius from the start-end distance", () => {
  const result = gradientResult();
  result.objects = result.objects.map((entry) =>
    entry.typeKey === 22 ? { ...entry, typeKey: 17 } : entry
  );
  const [artboard] = decodeRiv(result);
  const svg = artboard!.sourceSvg;
  // radius = hypot(100, 100) ≈ 141.42
  assert.match(svg, /<radialGradient id="mcp-grad-7" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="141\.4214"/);
});

test("stroke paints can reference gradients too", () => {
  const result = gradientResult();
  result.objects = result.objects.filter((entry) => entry.contextId !== 6);
  result.objects.push(obj(6, 24, [[5, 2], [47, 3]])); // stroke instead of fill
  const [artboard] = decodeRiv(result);
  const svg = artboard!.sourceSvg;
  assert.match(svg, /stroke="url\(#mcp-grad-7\)" stroke-width="3"/);
});
