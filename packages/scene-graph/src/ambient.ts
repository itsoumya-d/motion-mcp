import type { MotionStateNode } from "@motion-mcp/shared-types";
import type { SceneArtboard, SceneLayer, SceneStateMachine } from "./types.js";
import { clipFromStateNode } from "./compile.js";

/**
 * Ambient-life spec: the minimal description the app-wide sweep needs to
 * give any asset a living idle presence, regardless of anatomy depth.
 */
export interface AmbientLifeSpec {
  artboardId: string;
  name: string;
  /** Named animatable part ids from the asset's SVG tree. */
  parts: string[];
  /** Capability ids from anatomy analysis (blink/wave/wobble/sparkle…). */
  capabilities?: string[];
  screenId?: string;
  sourceFile?: string;
}

interface LifeStatePlan {
  stateId: string;
  name: string;
  kind: MotionStateNode["kind"];
  loop?: boolean;
  eventIn?: string;
  eventOut?: string;
  description: string;
}

const BASE_STATES: LifeStatePlan[] = [
  { stateId: "state-idle", name: "idle-breathe", kind: "entry", loop: true, description: "Ambient breathing loop keeps the asset alive at rest." },
  { stateId: "state-hover", name: "hover-lift", kind: "single", eventIn: "pointerEnter", eventOut: "pointerLeave", description: "Pointer lift affordance." },
  { stateId: "state-press", name: "press-squash", kind: "single", eventIn: "press", eventOut: "release", description: "Press feedback squash." }
];

/**
 * Compiles an app-wide ambient-life artboard for one asset:
 * grammar-driven idle/hover/press states over every named part, extended
 * with blink/error-wobble/success-pop when the detected anatomy supports it.
 * Deterministic — identical spec yields identical artboards.
 */
export function compileAmbientLifeScene(spec: AmbientLifeSpec): SceneArtboard {
  const targets = spec.parts.length > 0 ? [...spec.parts] : ["*"];
  const capabilities = new Set(spec.capabilities ?? []);

  const plans: LifeStatePlan[] = [...BASE_STATES];
  if (capabilities.has("blink")) {
    plans.push({ stateId: "state-blink", name: "idle-blink", kind: "single", description: "Occasional eye blink layered onto idle life." });
  }
  if (capabilities.has("wobble")) {
    plans.push({ stateId: "state-error", name: "error-shake", kind: "single", eventIn: "error", description: "Error shake doubles as jelly wobble." });
  }
  if (capabilities.has("sparkle") || capabilities.has("wave")) {
    plans.push({ stateId: "state-success", name: "success-pop", kind: "single", eventIn: "success", description: "Reward pop with sparkle accent." });
  }

  const states: MotionStateNode[] = plans.map((plan) => ({
    stateId: plan.stateId,
    name: plan.name,
    kind: plan.kind,
    loop: plan.loop ?? false,
    controlledParts: targets,
    description: plan.description,
    readyForCodegen: true
  }));

  const clips = Object.fromEntries(
    states.map((state) => {
      const clip = clipFromStateNode(state);
      return [clip.clipId, clip];
    })
  );

  const initialStateId = "state-idle";
  const transitions = [];
  for (const plan of plans) {
    if (!plan.eventIn || plan.stateId === initialStateId) continue;
    transitions.push({
      transitionId: `t-${plan.stateId}`,
      fromStateId: initialStateId,
      toStateId: plan.stateId,
      event: plan.eventIn,
      durationMs: 160,
      interpolation: "spring" as const,
      conditions: [],
      actions: []
    });
    if (plan.eventOut) {
      transitions.push({
        transitionId: `t-${plan.stateId}-back`,
        fromStateId: plan.stateId,
        toStateId: initialStateId,
        event: plan.eventOut,
        durationMs: plan.eventOut === "release" ? 220 : 260,
        interpolation: "cubic" as const,
        conditions: [],
        actions: []
      });
    }
  }

  const layer: SceneLayer = {
    layerId: `${spec.artboardId}:ambient`,
    name: "ambient-life",
    order: 0,
    targetParts: targets,
    initialStateId
  };

  const machine: SceneStateMachine = {
    stateMachineId: `${spec.artboardId}:ambient`,
    name: "AmbientLife",
    initialStateId,
    layerId: layer.layerId,
    states: states.map((state) => ({
      stateId: state.stateId,
      name: state.name,
      kind: state.kind,
      clipId: `clip-${state.stateId}`,
      loop: state.loop,
      controlledParts: [...state.controlledParts]
    })),
    transitions
  };

  return {
    artboardId: spec.artboardId,
    name: spec.name,
    sourceFile: spec.sourceFile,
    screenId: spec.screenId,
    layers: [layer],
    clips,
    stateMachines: [machine],
    bindings: [],
    listeners: [
      {
        listenerId: "listener-pointer-enter",
        type: "pointer",
        event: "pointerEnter",
        sends: "pointerEnter",
        targetPart: targets[0] === "*" ? undefined : targets[0],
        description: "Pointer enter routes to hover-lift."
      },
      {
        listenerId: "listener-press",
        type: "press",
        event: "press",
        sends: "press",
        description: "Press routes to press-squash."
      }
    ],
    audioEvents: [],
    semantics: { reducedMotionSafe: true }
  };
}
