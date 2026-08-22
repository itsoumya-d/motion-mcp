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
