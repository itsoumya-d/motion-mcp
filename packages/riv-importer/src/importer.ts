import { BACKING_TYPE_NAME, BinaryReader, readValue, type BackingType, type PropertyValue } from "./reader.js";

/**
 * Core type keys from rive-runtime dev/defs (format major 7 baseline).
 * These are stable identifiers shared between editor exports and runtimes.
 */
export const KNOWN_TYPE_NAMES: Record<number, string> = {
  1: "Artboard",
  2: "Node",
  3: "Shape",
  10: "Component",
  31: "LinearAnimation",
  53: "StateMachine",
  56: "StateMachineNumber",
  57: "StateMachineLayer",
  58: "StateMachineTrigger",
  59: "StateMachineBool",
  61: "AnimationState",
  62: "AnyState",
  63: "EntryState",
  64: "ExitState",
  65: "StateTransition"
};

/** Interesting core property keys (Component.name=4 is inherited everywhere). */
export const KNOWN_PROPERTY_NAMES: Record<number, string> = {
  4: "name",
  5: "parentId",
  56: "fps",
  57: "durationFrames",
  58: "speed",
  59: "loopValue",
  140: "numberValue",
  141: "boolValue",
  149: "animationId",
  150: "stateFromId",
  151: "stateToId",
  158: "duration",
  160: "exitTime",
  236: "defaultStateMachineId"
};

const STATE_KIND_BY_TYPE: Record<number, NonNullable<RivStateInfo["kind"]>> = {
  61: "animation",
  62: "any",
  63: "entry",
  64: "exit"
};

export interface RivPropertyEntry {
  key: number;
  value: PropertyValue;
}

export interface RivObject {
  objectIndex: number;
  /** Ordinal within the current artboard context — matches Rive Id semantics. */
  contextId: number;
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

export interface RivAnimationInfo {
  name?: string;
  fps?: number;
  durationFrames?: number;
  loopValue?: number;
  durationMs?: number;
}

export interface RivStateInfo {
  contextId: number;
  kind: "entry" | "any" | "exit" | "animation";
  animationName?: string;
  animationDurationMs?: number;
}

export interface RivTransitionInfo {
  fromId: number;
  toId: number;
  durationFrames?: number;
  exitTime?: number;
}

export interface RivStateMachineStructure {
  name?: string;
  inputs: Array<{ kind: "bool" | "number" | "trigger"; name?: string }>;
  layers: Array<{ states: RivStateInfo[]; transitions: RivTransitionInfo[] }>;
}

export interface RivArtboardStructure {
  name?: string;
  animations: RivAnimationInfo[];
  stateMachines: RivStateMachineStructure[];
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
  let contextOrdinal = -1;
  while (!reader.outOfData && reader.remaining > 0) {
    const typeKey = reader.varuint();
    if (reader.outOfData) break;
    if (typeKey === 0) {
      // Stray terminator — tolerate and continue.
      continue;
    }
    if (typeKey === 1) contextOrdinal = 0; // new artboard context
    const object: RivObject = {
      objectIndex,
      contextId: Math.max(contextOrdinal, 0),
      typeKey,
      typeName: KNOWN_TYPE_NAMES[typeKey],
      properties: []
    };
    if (typeKey !== 1) contextOrdinal += 1;
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

// ---------------------------------------------------------------------------
// Structural extraction — maps raw objects into artboards, animations,
// state machines (layers/states/transitions/inputs) using the core type keys.
// ---------------------------------------------------------------------------

function propOf(object: RivObject, key: number): PropertyValue | undefined {
  return object.properties.find((entry) => entry.key === key)?.value;
}

function numProp(object: RivObject, key: number): number | undefined {
  const value = propOf(object, key);
  if (!value) return undefined;
  if (value.kind === "uint" || value.kind === "float" || value.kind === "color") return value.value;
  return undefined;
}

function nameProp(object: RivObject): string | undefined {
  const value = propOf(object, 4);
  return value?.kind === "string" && value.value.length > 0 ? value.value : undefined;
}

export function extractStructure(result: RivImportResult): RivArtboardStructure[] {
  const artboards: RivArtboardStructure[] = [];
  let current: RivArtboardStructure | null = null;
  let currentMachine: RivStateMachineStructure | null = null;
  let currentLayer: RivStateMachineStructure["layers"][number] | null = null;
  /** contextId → resolved info for Id lookups (animations + states). */
  const byContextId = new Map<number, { animation?: RivAnimationInfo; state?: RivStateInfo }>();

  for (const object of result.objects) {
    switch (object.typeKey) {
      case 1: {
        current = { name: nameProp(object), animations: [], stateMachines: [] };
        artboards.push(current);
        currentMachine = null;
        currentLayer = null;
        break;
      }
      case 31: {
        if (!current) break;
        const fps = numProp(object, 56);
        const durationFrames = numProp(object, 57);
        const loopValue = numProp(object, 59);
        const animation: RivAnimationInfo = {
          name: nameProp(object),
          fps,
          durationFrames,
          loopValue,
          durationMs:
            fps !== undefined && fps > 0 && durationFrames !== undefined
              ? Math.round((durationFrames / fps) * 1000)
              : undefined
        };
        current.animations.push(animation);
        byContextId.set(object.contextId, { animation });
        break;
      }
      case 53: {
        if (!current) break;
        currentMachine = { name: nameProp(object), inputs: [], layers: [] };
        current.stateMachines.push(currentMachine);
        currentLayer = null;
        break;
      }
      case 56:
      case 58:
      case 59: {
        if (!currentMachine) break;
        currentMachine.inputs.push({
          kind: object.typeKey === 59 ? "bool" : object.typeKey === 56 ? "number" : "trigger",
          name: nameProp(object)
        });
        break;
      }
      case 57: {
        if (!currentMachine) break;
        currentLayer = { states: [], transitions: [] };
        currentMachine.layers.push(currentLayer);
        break;
      }
      case 61:
      case 62:
      case 63:
      case 64: {
        if (!current || !currentLayer) break;
        const kind = STATE_KIND_BY_TYPE[object.typeKey]!;
        const state: RivStateInfo = { contextId: object.contextId, kind };
        if (object.typeKey === 61) {
          const ref = byContextId.get(numProp(object, 149) ?? -1);
          state.animationName = ref?.animation?.name;
          state.animationDurationMs = ref?.animation?.durationMs;
        }
        currentLayer.states.push(state);
        byContextId.set(object.contextId, { state });
        break;
      }
      case 65: {
        if (!currentLayer) break;
        currentLayer.transitions.push({
          fromId: numProp(object, 150) ?? -1,
          toId: numProp(object, 151) ?? -1,
          durationFrames: numProp(object, 158),
          exitTime: numProp(object, 160)
        });
        break;
      }
      default:
        break;
    }
  }

  return artboards;
}

function byteOffset(reader: BinaryReader): number {
  return reader.offset + 4; // + magic prefix
}

function isRiveMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x56 && bytes[3] === 0x45;
}
