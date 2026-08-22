import type {
  MotionStateNode,
  PageStateMachineExperience,
  RiveLikeTransition
} from "@motion-mcp/shared-types";
import type {
  SceneArtboard,
  SceneClip,
  SceneDoc,
  SceneEasing,
  SceneKeyframe,
  SceneLayer,
  SceneState,
  SceneStateMachine,
  SceneTrack
} from "./types.js";
import { SCENE_FORMAT_VERSION } from "./types.js";

export interface MotionDocJson {
  format?: string;
  version?: number;
  id?: string;
  fps?: number | null;
  durationMs: number;
  loop: boolean;
  meta?: Record<string, unknown>;
  tracks: Record<string, number[][]>;
  translations?: Record<string, number[][]>;
}

/**
 * Compiles a Rive-like page state-machine experience spec into a SceneArtboard.
 *
 * This is the seam that closes motion-mcp's original spec-to-code disconnect:
 * every detected state becomes a real keyframed clip via the motion grammar,
 * so emitters render actual timing data instead of a fixed template.
 */
export function compileExperienceToScene(
  experience: PageStateMachineExperience
): SceneArtboard {
  const clips: Record<string, SceneClip> = {};
  for (const layer of experience.layers) {
    for (const state of layer.states) {
      const clip = clipFromStateNode(state);
      clips[clip.clipId] = sortClip(clip);
    }
  }

  const layers: SceneLayer[] = experience.layers.map((layer) => ({
    layerId: layer.layerId,
    name: layer.name,
    order: layer.order,
    priority: layer.priority,
    targetParts: [...layer.ownedParts],
    initialStateId: layer.initialStateId
  }));

  const stateMachines: SceneStateMachine[] = experience.layers.map((layer) => ({
    stateMachineId: `${experience.pageId}:${layer.layerId}`,
    name: layer.name,
    initialStateId: layer.initialStateId,
    layerId: layer.layerId,
    states: layer.states.map(sceneStateFrom),
    transitions: experience.transitions
      .filter((transition) => transition.layerId === layer.layerId)
      .map(sceneTransitionFrom)
  }));

  return {
    artboardId: experience.pageId,
    name: experience.name || experience.file.split("/").pop() || "page",
    sourceFile: experience.file,
    screenId: experience.screenId,
    routePattern: experience.routePattern,
    framework: experience.framework,
    experienceSummary: experience.experienceSummary,
    restraintRules: [...experience.restraintRules],
    layers,
    clips,
    stateMachines,
    bindings: experience.bindings.map((binding) => ({ ...binding })),
    listeners: experience.listeners.map((listener) => ({ ...listener })),
    audioEvents: [],
    semantics: { reducedMotionSafe: true }
  };
}

function sceneStateFrom(state: MotionStateNode): SceneState {
  return {
    stateId: state.stateId,
    name: state.name,
    kind: state.kind,
    clipId: `clip-${state.stateId}`,
    loop: state.loop,
    playbackSpeed: state.playbackSpeed,
    blendProperty: state.blendProperty,
    blendRange: state.blendRange ? { ...state.blendRange } : undefined,
    controlledParts: [...state.controlledParts]
  };
}

function sceneTransitionFrom(transition: RiveLikeTransition): SceneStateMachine["transitions"][number] {
  return {
    transitionId: transition.transitionId,
    fromStateId: transition.fromStateId,
    toStateId: transition.toStateId,
    event: transition.event,
    durationMs: transition.timing.durationMs,
    interpolation: transition.timing.interpolation,
    exitTimeMs: exitTimeToMs(transition),
    conditions: transition.conditions.map((condition) => ({ ...condition })),
    actions: transition.actions.map((action) => ({ ...action }))
  };
}

function exitTimeToMs(transition: RiveLikeTransition): number | undefined {
  const exit = transition.timing.exitTime;
  if (exit === undefined) return undefined;
  if (transition.timing.exitTimeUnit === "percent") {
    return Math.round((exit / 100) * transition.timing.durationMs);
  }
  return Math.round(exit * 1000);
}

/**
 * The motion grammar: turns semantic state metadata into concrete keyframes.
 * Deterministic and pure — identical input always yields identical clips.
 */
export function clipFromStateNode(state: MotionStateNode): SceneClip {
  const targets = state.controlledParts.length > 0 ? state.controlledParts : ["*"];
  const grammar = grammarForStateName(state.name);
  const tracks: SceneTrack[] = [];
  for (const [partIndex, part] of targets.entries()) {
    for (const template of grammar.tracks) {
      tracks.push({
        targetPart: part,
        property: template.property,
        keys: template.keys.map((key) => ({
          ...key,
          value: key.value,
          t: key.t + partIndex * grammar.staggerMs
        }))
      });
    }
  }
  return {
    clipId: `clip-${state.stateId}`,
    name: state.name,
    durationMs: grammar.durationMs ?? 300,
    loop: Boolean(state.loop),
    tracks
  };
}

interface GrammarTemplate {
  property: string;
  keys: Array<{ t: number; value: number | string | number[]; easing?: SceneEasing }>;
}

interface Grammar {
  durationMs?: number;
  staggerMs: number;
  tracks: GrammarTemplate[];
}

function grammarForStateName(name: string): Grammar {
  const lowered = name.toLowerCase();
  if (/idle|rest|breathe/.test(lowered)) {
    return {
      durationMs: 3400,
      staggerMs: 60,
      tracks: [
        { property: "scale", keys: [{ t: 0, value: 1 }, { t: 1700, value: 1.012, easing: "easeInOut" }, { t: 3400, value: 1 }] },
        { property: "opacity", keys: [{ t: 0, value: 0.92 }, { t: 1700, value: 1, easing: "easeInOut" }, { t: 3400, value: 0.92 }] }
      ]
    };
  }
  if (/hover/.test(lowered)) {
    return {
      staggerMs: 25,
      tracks: [
        { property: "translateY", keys: [{ t: 0, value: 0 }, { t: 180, value: -2, easing: "easeOut" }] },
        { property: "scale", keys: [{ t: 0, value: 1 }, { t: 180, value: 1.012, easing: "easeOut" }] }
      ]
    };
  }
  if (/press|down/.test(lowered)) {
    return {
      staggerMs: 15,
      tracks: [
        { property: "scale", keys: [{ t: 0, value: 1 }, { t: 80, value: 0.965, easing: "easeOut" }] }
      ]
    };
  }
  if (/success|complete|reward/.test(lowered)) {
    return {
      durationMs: 620,
      staggerMs: 25,
      tracks: [
        { property: "scale", keys: [{ t: 0, value: 1 }, { t: 240, value: 1.08, easing: "easeOut" }, { t: 620, value: 1, easing: "easeInOut" }] },
        { property: "rotate", keys: [{ t: 0, value: 0 }, { t: 240, value: 1.5, easing: "easeOut" }, { t: 620, value: 0 }] }
      ]
    };
  }
  if (/error|fail|warn/.test(lowered)) {
    return {
      durationMs: 340,
      staggerMs: 10,
      tracks: [
        { property: "translateX", keys: [
          { t: 0, value: 0 },
          { t: 70, value: -2, easing: "linear" },
          { t: 150, value: 2, easing: "linear" },
          { t: 230, value: -1, easing: "linear" },
          { t: 340, value: 0 }
        ] }
      ]
    };
  }
  if (/disabled|inactive/.test(lowered)) {
    return {
      staggerMs: 0,
      tracks: [
        { property: "opacity", keys: [{ t: 0, value: 0.48, easing: "hold" }] }
      ]
    };
  }
  if (/active|selected|on/.test(lowered)) {
    return {
      staggerMs: 35,
      tracks: [
        { property: "pathLength", keys: [{ t: 0, value: 0 }, { t: 420, value: 1, easing: "easeInOut" }] },
        { property: "scale", keys: [{ t: 0, value: 1 }, { t: 420, value: 1.02, easing: "spring" }] }
      ]
    };
  }
  // Fallback: gentle emphasis so unknown states still animate coherently
  return {
    durationMs: 420,
    staggerMs: 25,
    tracks: [
      { property: "opacity", keys: [{ t: 0, value: 0.85 }, { t: 420, value: 1, easing: "easeInOut" }] }
    ]
  };
}

/** Adapts a pipeline-baked skeletal MotionDoc into a generic SceneClip. */
export function sceneClipFromMotionDoc(doc: MotionDocJson): SceneClip {
  const tracks: SceneTrack[] = [];
  for (const [joint, rows] of Object.entries(doc.tracks ?? {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    tracks.push({
      targetPart: joint,
      property: "jointRotation",
      keys: rows
        .map((row) => ({ t: row[0]!, value: [row[1]!, row[2]!, row[3]!] as number[] }))
        .sort((a, b) => a.t - b.t)
    });
  }
  for (const [joint, rows] of Object.entries(doc.translations ?? {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    tracks.push({
      targetPart: joint,
      property: "jointTranslation",
      keys: rows
        .map((row) => ({ t: row[0]!, value: [row[1]!, row[2]!, row[3]!] as number[] }))
        .sort((a, b) => a.t - b.t)
    });
  }
  return {
    clipId: doc.id ?? "motiondoc-clip",
    name: String(doc.meta?.exercise ?? doc.id ?? "baked"),
    durationMs: doc.durationMs,
    loop: Boolean(doc.loop),
    tracks
  };
}

function sortClip(clip: SceneClip): SceneClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => ({
      ...track,
      keys: [...track.keys].sort((a, b) => a.t - b.t)
    }))
  };
}

// ---------------------------------------------------------------------------
// Deterministic sampling — the reference evaluator used by conformance tests.
// Emitters map these easings onto native curves; this sampler is the truth.
// ---------------------------------------------------------------------------

export function sampleSceneTrack(track: SceneTrack, timeMs: number): number | string | number[] {
  const keys = track.keys;
  if (keys.length === 0) return 0;
  const first = keys[0]!;
  if (keys.length === 1 || timeMs <= first.t) return first.value;
  const last = keys[keys.length - 1]!;
  if (timeMs >= last.t) return last.value;
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= timeMs) lo = mid;
    else hi = mid;
  }
  const k0 = keys[lo]!;
  const k1 = keys[hi]!;
  const span = Math.max(k1.t - k0.t, 1e-6);
  const raw = (timeMs - k0.t) / span;
  // Convention: easing lives on the ARRIVING keyframe (CSS/Framer style) and
  // describes how the segment approaches that key.
  const eased = applyEasing(raw, k1.easing);
  return interpolateValues(k0.value, k1.value, eased);
}

function interpolateValues(
  a: number | string | number[],
  b: number | string | number[],
  u: number
): number | string | number[] {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((value, index) => value + ((b[index] ?? value) - value) * u);
  }
  return u < 1 ? a : b;
}

export function applyEasing(u: number, easing: SceneEasing | undefined): number {
  const clamped = Math.min(Math.max(u, 0), 1);
  switch (easing) {
    case "hold":
      return 0;
    case "easeIn":
      return clamped * clamped;
    case "easeOut":
      return 1 - (1 - clamped) * (1 - clamped);
    case "easeInOut": {
      const s = clamped * clamped * (3 - 2 * clamped);
      return s;
    }
    case "spring": {
      // Damped-spring approximation: fast rise, small overshoot, settle at 1.
      const x = clamped;
      return 1 - Math.exp(-6 * x) * Math.cos(9 * x) * (1 - x);
    }
    case "linear":
    default:
      return clamped;
  }
}

export interface SceneValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSceneDoc(doc: SceneDoc): SceneValidationResult {
  const errors: string[] = [];
  if (doc.formatVersion !== SCENE_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${SCENE_FORMAT_VERSION}`);
  }
  if (!doc.sceneId) errors.push("sceneId is required");
  const artboardIds = new Set<string>();
  for (const artboard of doc.artboards) {
    if (artboardIds.has(artboard.artboardId)) {
      errors.push(`duplicate artboardId ${artboard.artboardId}`);
    }
    artboardIds.add(artboard.artboardId);
    validateArtboard(artboard, errors);
  }
  return { ok: errors.length === 0, errors };
}

function validateArtboard(artboard: SceneArtboard, errors: string[]): void {
  const prefix = `[${artboard.artboardId}]`;
  const clipIds = new Set(Object.keys(artboard.clips));
  const layerIds = new Set<string>();
  for (const layer of artboard.layers) {
    if (layerIds.has(layer.layerId)) errors.push(`${prefix} duplicate layerId ${layer.layerId}`);
    layerIds.add(layer.layerId);
  }
  const machineIds = new Set<string>();
  for (const machine of artboard.stateMachines) {
    if (machineIds.has(machine.stateMachineId)) {
      errors.push(`${prefix} duplicate stateMachineId ${machine.stateMachineId}`);
    }
    machineIds.add(machine.stateMachineId);
    const stateIds = new Set<string>();
    for (const state of machine.states) {
      if (stateIds.has(state.stateId)) errors.push(`${prefix} duplicate stateId ${state.stateId}`);
      stateIds.add(state.stateId);
      if (state.clipId && !clipIds.has(state.clipId)) {
        errors.push(`${prefix} state ${state.stateId} references missing clip ${state.clipId}`);
      }
      validateTracks(artboard.clips[state.clipId ?? ""], prefix, errors);
    }
    if (!stateIds.has(machine.initialStateId)) {
      errors.push(`${prefix} initial state ${machine.initialStateId} not found`);
    }
    for (const transition of machine.transitions) {
      if (transition.fromStateId !== "*" && !stateIds.has(transition.fromStateId)) {
        errors.push(`${prefix} transition ${transition.transitionId} references missing from-state ${transition.fromStateId}`);
      }
      if (!stateIds.has(transition.toStateId)) {
        errors.push(`${prefix} transition ${transition.transitionId} references missing to-state ${transition.toStateId}`);
      }
    }
  }
}

function validateTracks(clip: SceneClip | undefined, prefix: string, errors: string[]): void {
  if (!clip) return;
  for (const track of clip.tracks) {
    let previousT = -Infinity;
    for (const key of track.keys) {
      if (!Number.isFinite(key.t) || key.t < 0) {
        errors.push(`${prefix} clip ${clip.clipId} has invalid keyframe time ${key.t}`);
      }
      if (key.t < previousT) {
        errors.push(`${prefix} clip ${clip.clipId} track ${track.targetPart}/${track.property} keys are not sorted`);
      }
      previousT = key.t;
      if (typeof key.value === "number" && !Number.isFinite(key.value)) {
        errors.push(`${prefix} clip ${clip.clipId} has non-finite keyframe value`);
      }
    }
  }
}
