/**
 * Little-endian binary reader for the .riv runtime format.
 * Implements: varuint (LEB128), u32, f32 (IEEE 754), length-prefixed
 * UTF-8 strings, and the ToC's byte-aligned 2-bit-per-property backing
 * type array. All reads bounds-check so truncated files surface as a
 * clean `outOfData` flag instead of garbage.
 */
export class BinaryReader {
  readonly bytes: Uint8Array;
  offset = 0;
  outOfData = false;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get remaining(): number {
    return Math.max(0, this.bytes.length - this.offset);
  }

  varuint(): number {
    let result = 0;
    let shift = 0;
    for (let guard = 0; guard < 10; guard += 1) {
      if (this.offset >= this.bytes.length) {
        this.outOfData = true;
        return 0;
      }
      const byte = this.bytes[this.offset++]!;
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    // Malformed LEB128 chain — treat as stream corruption.
    this.outOfData = true;
    return 0;
  }

  u32(): number {
    if (this.remaining < 4) {
      this.outOfData = true;
      return 0;
    }
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4);
    this.offset += 4;
    return view.getUint32(0, true);
  }

  f32(): number {
    if (this.remaining < 4) {
      this.outOfData = true;
      return 0;
    }
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4);
    this.offset += 4;
    return view.getFloat32(0, true);
  }

  string(): string {
    const length = this.varuint();
    if (this.outOfData) return "";
    if (length > this.remaining) {
      this.outOfData = true;
      return "";
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(slice);
  }

  /**
   * Reads the ToC backing-type bit array: `count` properties × 2 bits,
   * packed into ceil(count/4) bytes.
   */
  backingTypes(count: number): BackingType[] {
    const types: BackingType[] = [];
    const totalBytes = Math.ceil(count / 4);
    for (let index = 0; index < count; index += 1) {
      const byteIndex = Math.floor(index / 4);
      if (byteIndex >= totalBytes || this.remaining === 0) {
        this.outOfData = true;
        break;
      }
      const bits = this.bytes[this.offset + byteIndex]!;
      types.push(((bits >> ((index % 4) * 2)) & 0x03) as BackingType);
    }
    this.offset += totalBytes;
    return types;
  }
}

export type BackingType = 0 | 1 | 2 | 3;

export const BACKING_TYPE_NAME: Record<BackingType, string> = {
  0: "uint",
  1: "string",
  2: "float",
  3: "color"
};

export type PropertyValue =
  | { kind: "uint"; value: number }
  | { kind: "string"; value: string }
  | { kind: "float"; value: number }
  | { kind: "color"; value: number };

/** Reads one property value using its ToC-declared backing type. */
export function readValue(reader: BinaryReader, type: BackingType): PropertyValue {
  switch (type) {
    case 1:
      return { kind: "string", value: reader.string() };
    case 2:
      return { kind: "float", value: roundFloat(reader.f32()) };
    case 3:
      return { kind: "color", value: reader.u32() };
    case 0:
    default:
      return { kind: "uint", value: reader.varuint() };
  }
}

function roundFloat(value: number): number {
  return Math.round(value * 10000) / 10000;
}
