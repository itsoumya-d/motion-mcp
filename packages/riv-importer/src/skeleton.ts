import type { SceneArtboard, SceneDoc, SceneState, SceneTransition } from "@motion-mcp/scene-graph";
import {
  extractStructure,
  KNOWN_TYPE_NAMES,
  type RivImportResult,
  type RivStateMachineStructure,
  type RivTransitionInfo
} from "./importer.js";
import { decodeRiv } from "./decode.js";

const FALLBACK_FPS = 60;

/**
 * Builds SceneDocs from parsed .riv content.
 *
 * v2: every detected Rive artboard becomes a SceneArtboard carrying its real
 * animations inventory and state-machine topology (entry/any/exit/animation
 * states, transitions with timing). Keyframe-level clip data is not yet
 * decoded, so `clips` stays empty and states carry no clipIds — honest
 * topology without fabricated motion.
 */
export function toSceneSkeleton(result: RivImportResult, fallbackName = "riv-import"): SceneDoc {
  const structures = extractStructure(result);
  const header = result.header;

  if (structures.length === 0) {
    // No recognizable artboards — fall back to a single inventory artboard.
    const name = result.strings[0]?.value ?? fallbackName;
    const artboard: SceneArtboard & { rivInventory?: Record<string, unknown> } = {
      artboardId: `riv_${header?.fileId ?? 0}`,
      name,
      experienceSummary:
        `Rive format ${header ? `${header.majorVersion}.${header.minorVersion}` : "?"} — ` +
        `${result.objects.length} objects, ${result.strings.length} named strings.`,
      layers: [],
      clips: {},
      stateMachines: [],
      bindings: [],
      listeners: [],
      audioEvents: [],
      semantics: { reducedMotionSafe: false },
      rivInventory: {
        majorVersion: header?.majorVersion,
        minorVersion: header?.minorVersion,
        fileId: header?.fileId,
        objectCount: result.objects.length,
        typeHistogram: result.typeHistogram,
        strings: result.strings.map((hit) => hit.value),
        warnings: result.warnings
      }
    };
    return {
      formatVersion: 1,
      sceneId: `scene_riv_${header?.fileId ?? "unknown"}`,
      name,
      createdAt: new Date().toISOString(),
      artboards: [artboard]
    };
  }

  const decoded = decodeRiv(result);
  const artboards: SceneArtboard[] = structures.map((structure, index) => {
    const machineSummaries = structure.stateMachines.map((machine) => summarizeMachine(machine));
    const decodedBoard = decoded[index];
    const clips = { ...(decodedBoard?.clips ?? {}) };
    return {
      artboardId: `riv_${header?.fileId ?? 0}_ab${index}`,
      name: structure.name ?? `${fallbackName}-${index}`,
      experienceSummary:
        `${structure.animations.length} linear animation(s), ` +
        `${structure.stateMachines.length} state machine(s)` +
        (clips && Object.keys(clips).length > 0
          ? `, ${Object.keys(clips).length} keyframed clip(s) decoded`
          : "") +
        ".",
      layers: [],
      clips,
      stateMachines: structure.stateMachines
        .map((machine, smIndex) => toSceneStateMachine(machine, smIndex))
        .filter((machine): machine is NonNullable<typeof machine> => machine !== null),
      bindings: [],
      listeners: [],
      audioEvents: [],
      semantics: { reducedMotionSafe: false },
      sourceSvg: decodedBoard?.sourceSvg,
      rivInventory: {
        width: decodedBoard?.width,
        height: decodedBoard?.height,
        pathCount: decodedBoard?.paths.length ?? 0,
        animations: structure.animations,
        stateMachines: machineSummaries,
        typeHistogram: filteredHistogram(result, index),
        warnings: result.warnings
      }
    };
  });

  return {
    formatVersion: 1,
    sceneId: `scene_riv_${header?.fileId ?? "unknown"}`,
    name: artboards[0]!.name,
    createdAt: new Date().toISOString(),
    artboards
  };
}

function toSceneStateMachine(
  machine: RivStateMachineStructure,
  index: number
): { stateMachineId: string; name: string; initialStateId: string; states: SceneState[]; transitions: SceneTransition[]; layerCount: number } | null {
  const layer = machine.layers[0];
  if (!layer || layer.states.length === 0) return null;

  const states: SceneState[] = layer.states.map((state) => {
    const animationName = state.animationName;
    const clipKey = animationName
      ? `clip-riv-anim-${animationName.toLowerCase().replace(/[^a-z0-9]+/g, "")}`
      : undefined;
    return {
      stateId: `riv_${state.contextId}`,
      name: animationName ?? state.kind,
      kind: state.kind === "any" ? "any" : state.kind === "exit" ? "exit" : state.kind === "entry" ? "entry" : "single",
      controlledParts: [],
      loop: undefined,
      playbackSpeed: undefined,
      clipId: clipKey
    };
  });

  const knownIds = new Set(states.map((state) => state.stateId));
  const transitions: SceneTransition[] = layer.transitions
    .filter((transition) => knownIds.has(`riv_${transition.fromId}`) && knownIds.has(`riv_${transition.toId}`))
    .map((transition) => ({
      transitionId: `riv_t_${transition.fromId}_${transition.toId}`,
      fromStateId: `riv_${transition.fromId}`,
      toStateId: `riv_${transition.toId}`,
      durationMs: framesToMs(transition.durationFrames ?? 0, FALLBACK_FPS),
      interpolation: "linear",
      conditions: [],
      actions: []
    }));

  const entry = layer.states.find((state) => state.kind === "entry") ?? layer.states[0]!;
  return {
    stateMachineId: `riv_sm_${index}`,
    name: machine.name ?? `State Machine ${index + 1}`,
    initialStateId: `riv_${entry.contextId}`,
    states,
    transitions,
    layerCount: machine.layers.length
  };
}

/** Frames → ms at the file's typical 60fps timeline rate (documented approximation). */
function framesToMs(frames: number, fps: number): number {
  return Math.round((frames / fps) * 1000);
}

function summarizeMachine(machine: RivStateMachineStructure) {
  return {
    name: machine.name,
    inputs: machine.inputs,
    layers: machine.layers.map((layer) => ({
      states: layer.states.map((state) => ({
        kind: state.kind,
        animationName: state.animationName,
        animationDurationMs: state.animationDurationMs
      })),
      transitions: layer.transitions.map((transition) => ({
        from: transition.fromId,
        to: transition.toId,
        durationFrames: transition.durationFrames,
        exitTime: transition.exitTime
      }))
    }))
  };
}

function filteredHistogram(result: RivImportResult, _artboardIndex: number): Record<string, number> {
  void _artboardIndex;
  return Object.fromEntries(
    Object.entries(result.typeHistogram).map(([key, count]) => [
      KNOWN_TYPE_NAMES[Number(key)] ?? `type${key}`,
      count
    ])
  );
}

// Re-exported for tooling convenience.
export { framesToMs };
export type { RivTransitionInfo };
