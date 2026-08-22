import { BACKING_TYPE_NAME, BinaryReader, readValue, type BackingType, type PropertyValue } from "./reader.js";

export const KNOWN_TYPE_NAMES: Record<number, string> = {
  2: "Node",
  3: "Shape"
};

export interface RivPropertyEntry {
  key: number;
  value: PropertyValue;
}

export interface RivObject {
  objectIndex: number;
  typeKey: number;
  typeName?: string;
  properties: RivPropertyEntry[];
}

export interface RivStringHit {
  objectIndex: number;
  typeKey: number;
  value: string;
}

export interface RivHeader {
  majorVersion: number;
  minorVersion: number;
  fileId: number;
}

export interface RivImportResult {
  ok: boolean;
  header?: RivHeader;
  /** ToC property keys with their declared backing types. */
  propertyTable: Array<{ key: number; backingType: BackingType; backingTypeName: string }>;
  objects: RivObject[];
  strings: RivStringHit[];
  typeHistogram: Record<string, number>;
  warnings: string[];
  /** Byte offset where reading stopped when the stream truncated. */
  stoppedAtByte?: number;
}

/**
 * Parses a .riv file per the public runtime format spec:
 * fingerprint + major/minor/fileId varuints, a ToC (varuint property keys
 * terminated by 0 followed by a 2-bits-per-property backing-type array),
 * then the object stream (typeKey varuint, property list terminated by 0).
 *
 * Baseline properties are intentionally absent from the ToC by design; when
 * the stream references one of those unknown keys we cannot know its size,
 * so parsing stops cleanly and reports what it recovered.
 */
export function importRiv(bytes: Uint8Array): RivImportResult {
  const result: RivImportResult = {
    ok: false,
    propertyTable: [],
    objects: [],
    strings: [],
    typeHistogram: {},
    warnings: []
  };

  if (bytes.length < 4 || !isRiveMagic(bytes)) {
    result.warnings.push("missing RIVE fingerprint — not a .riv file");
    return result;
  }

  const reader = new BinaryReader(bytes.subarray(4));
  const majorVersion = reader.varuint();
  const minorVersion = reader.varuint();
  const fileId = reader.varuint();
  if (reader.outOfData) {
    result.warnings.push("truncated header");
    result.stoppedAtByte = reader.offset + 4;
    return result;
  }
  result.header = { majorVersion, minorVersion, fileId };

  // --- Table of contents -------------------------------------------------
  const keys: number[] = [];
  while (true) {
    const key = reader.varuint();
    if (reader.outOfData) {
      result.warnings.push("truncated inside ToC key list");
      result.stoppedAtByte = byteOffset(reader);
      return finalize(result);
    }
    if (key === 0) break;
    keys.push(key);
  }
  const types = reader.backingTypes(keys.length);
  if (reader.outOfData) {
    result.warnings.push("truncated inside ToC backing-type bits");
    result.stoppedAtByte = byteOffset(reader);
    return finalize(result);
  }
  for (let index = 0; index < Math.min(keys.length, types.length); index += 1) {
    result.propertyTable.push({
      key: keys[index]!,
      backingType: types[index]!,
      backingTypeName: BACKING_TYPE_NAME[types[index]!]
    });
  }
  const backingByKey = new Map<number, BackingType>();
  for (const entry of result.propertyTable) backingByKey.set(entry.key, entry.backingType);

  // --- Object stream ------------------------------------------------------
  let objectIndex = 0;
  while (!reader.outOfData && reader.remaining > 0) {
    const typeKey = reader.varuint();
    if (reader.outOfData) break;
    if (typeKey === 0) {
      // Stray terminator — tolerate and continue.
      continue;
    }
    const object: RivObject = {
      objectIndex,
      typeKey,
      typeName: KNOWN_TYPE_NAMES[typeKey],
      properties: []
    };
    while (true) {
      const propKey = reader.varuint();
      if (reader.outOfData) break;
      if (propKey === 0) break;
      const backing = backingByKey.get(propKey);
      if (backing === undefined) {
        result.warnings.push(
          `baseline/unknown property ${propKey} on object #${objectIndex} (type ${typeKey}) is not in the ToC; stopped for safety`
        );
        result.stoppedAtByte = byteOffset(reader);
        return finalize(result, true);
      }
      const value = readValue(reader, backing);
      if (reader.outOfData) break;
      object.properties.push({ key: propKey, value });
      if (value.kind === "string" && value.value.length > 0) {
        result.strings.push({ objectIndex, typeKey, value: value.value });
      }
    }
    result.objects.push(object);
    const histogramKey = String(typeKey);
    result.typeHistogram[histogramKey] = (result.typeHistogram[histogramKey] ?? 0) + 1;
    objectIndex += 1;
    if (reader.outOfData) {
      result.warnings.push("stream ended mid-object; partial object kept");
      result.stoppedAtByte = byteOffset(reader);
      break;
    }
  }

  return finalize(result, true);
}

function finalize(result: RivImportResult, ok: boolean = false): RivImportResult {
  result.ok = ok;
  return result;
}

function byteOffset(reader: BinaryReader): number {
  return reader.offset + 4; // + magic prefix
}

function isRiveMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x56 && bytes[3] === 0x45;
}
