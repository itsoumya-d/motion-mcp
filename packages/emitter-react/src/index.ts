import path from "node:path";
import type { SceneArtboard } from "@motion-mcp/scene-graph";
import {
  STANDARD_MOTION_EVENTS,
  STANDARD_MOTION_STATES,
  type AssetInfo,
  type FileChange,
  type GenerateAnimationOptions,
  type MotionPlanItem,
  nowIso
} from "@motion-mcp/shared-types";

export interface ReactEmitterInput {
  planItem: MotionPlanItem;
  asset?: AssetInfo;
  options: GenerateAnimationOptions;
  /** SceneDoc artboard compiled from the page state-machine experience. */
  scene?: SceneArtboard;
}

export function emitReactAnimation(input: ReactEmitterInput): FileChange[] {
  const componentName = safeComponentName(input.asset?.path ?? input.planItem.file);
  const filePath = `.motion-mcp/generated/react/${componentName}.tsx`;
  const content = input.asset?.type === "svg" && input.asset.pathTree
    ? emitAnimatedSvgComponent(componentName, input)
    : emitMotionEnhancerComponent(componentName, input);
  return [
    {
      path: filePath,
      mode: "create",
      content
    }
  ];
}

// ---------------------------------------------------------------------------
// Scene model extraction
// ---------------------------------------------------------------------------

interface SceneRuntimeModel {
  states: string[];
  initialState: string;
  /** state -> event -> next state */
  transitions: Record<string, Record<string, string>>;
  /** normalized state name -> its compiled clip */
  clips: Record<string, import("@motion-mcp/scene-graph").SceneClip>;
  stateMachineName: string;
}

function extractSceneModel(scene?: SceneArtboard): SceneRuntimeModel | null {
  const machine = scene?.stateMachines[0];
  if (!machine || machine.states.length === 0) return null;
  const idToName = new Map(machine.states.map((state) => [state.stateId, normalizeStateName(state.name)]));
  const states = Array.from(new Set(Array.from(idToName.values())));
  const clips: SceneRuntimeModel["clips"] = {};
  for (const state of machine.states) {
    const name = idToName.get(state.stateId)!;
    const clip = state.clipId ? scene!.clips[state.clipId] : undefined;
    if (clip) clips[name] = clip;
  }
  const transitions: SceneRuntimeModel["transitions"] = {};
  for (const transition of machine.transitions) {
    if (!transition.event) continue;
    const from = transition.fromStateId === "*" ? "*" : idToName.get(transition.fromStateId);
    const to = idToName.get(transition.toStateId);
    if (!to) continue;
    for (const source of from === "*" ? ["*", ...states] : [from!]) {
      transitions[source] = transitions[source] ?? {};
      transitions[source]![transition.event] = to;
    }
  }
  return {
    states,
    initialState: idToName.get(machine.initialStateId) ?? states[0]!,
    transitions,
    clips,
    stateMachineName: machine.name
  };
}

function normalizeStateName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "idle";
}

type VariantLiteral = Record<string, unknown>;

const EASING_MAP: Record<string, string> = {
  linear: "linear",
  easeIn: "easeIn",
  easeOut: "easeOut",
  easeInOut: "easeInOut",
  hold: "linear",
  spring: "easeOut"
};

const PROPERTY_MAP: Record<string, string> = {
  translateX: "x",
  translateY: "y",
  scaleX: "scaleX",
  scaleY: "scaleY"
};

/** Builds a Framer-Motion variant literal from a clip, for one matched part. */
function buildVariantLiteral(
  clip: import("@motion-mcp/scene-graph").SceneClip,
  partTokens: string[]
): VariantLiteral {
  const variant: VariantLiteral = {};
  const transition: VariantLiteral = {};
  const relevant = clip.tracks.filter((track) =>
    track.targetPart === "*" || tokensMatch(track.targetPart, partTokens)
  );
  for (const track of relevant) {
    const property = PROPERTY_MAP[track.property] ?? track.property;
    const values = track.keys.map((key) => key.value);
    if (values.length === 0) continue;
    if (typeof values[0] === "number" || typeof values[0] === "string") {
      variant[property] = values.length === 1 ? values[0] : values;
    } else {
      variant[property] = values;
    }
    if (values.length > 1) {
      const durationSec = Number((clip.durationMs / 1000).toFixed(3));
      const times = track.keys.map((key) => Number((key.t / Math.max(clip.durationMs, 1)).toFixed(4)));
      transition.duration = Math.max(transition.duration as number | undefined ?? 0, durationSec);
      transition.times = times;
      const eased = track.keys
        .slice(1)
        .filter((key) => key.easing)
        .map((key) => EASING_MAP[key.easing!] ?? "easeInOut");
      if (eased.length > 0) transition.ease = eased;
    }
  }
  if (Object.keys(transition).length > 0) {
    variant.transition = transition;
  }
  return variant;
}

function tokensMatch(targetPart: string, partTokens: string[]): boolean {
  const needle = targetPart.toLowerCase();
  return partTokens.some((token) => token.toLowerCase().includes(needle) || needle.includes(token));
}

/**
 * Per-part variant sources: returns the JS source of a `PART_VARIANTS` array
 * where entry i holds every scene state's variant for part i. Falls back to
 * the classic template when no scene is provided.
 */
function emitSceneVariantsSource(model: SceneRuntimeModel, partTokenLists: string[][]): string | null {
  const anyClips = Object.keys(model.clips).length;
  if (anyClips === 0) return null;
  const entries = partTokenLists.map((tokens) => {
    const perState: Record<string, VariantLiteral> = {};
    for (const stateName of model.states) {
      const clip = model.clips[stateName];
      perState[stateName] = clip
        ? buildVariantLiteral(clip, tokens)
        : { opacity: 1 };
    }
    return perState;
  });
  return `const PART_VARIANTS = ${JSON.stringify(entries, null, 2)} as const;`;
}

function emitTransitionsSource(model: SceneRuntimeModel): string {
  return `const SCENE_TRANSITIONS: Record<string, Partial<Record<string, string>>> = ${JSON.stringify(
    model.transitions,
    null,
    2
  )};`;
}

function sceneSendFunctionSource(model: SceneRuntimeModel, activeParam = "active"): string {
  return `  const send = React.useCallback((event: string) => {
    setState((current) => {
      if (current === "disabled") return current;
      const next = SCENE_TRANSITIONS[current]?.[event] ?? SCENE_TRANSITIONS["*"]?.[event];
      if (next) return next as MotionState;
      switch (event) {
        case "pointerLeave": return ${activeParam} ? "${model.initialState}" : current;
        default: return current;
      }
    });
  }, [${activeParam}]);`;
}

// ---------------------------------------------------------------------------
// Data-binding wiring (Rive-like View Model inputs, sourced from app state)
// ---------------------------------------------------------------------------

interface BindingWiring {
  property: string;
  targetPart: string;
  event?: string;
}

/**
 * Maps scene bindings to generated runtime wiring. Properties with
 * error/loading/success semantics drive the matching MotionEvent; other
 * properties stay typed pass-through data for host code.
 */
function deriveWiring(bindings: Array<{ property: string; targetPart: string }>): BindingWiring[] {
  return bindings.map((binding) => ({
    ...binding,
    event: bindingEventFor(binding.property)
  }));
}

function bindingEventFor(property: string): string | undefined {
  const normalized = property.replace(/[^a-z0-9]/gi, "");
  if (/^(has|is)?errors?$|error$|^fail(ed|ure|s)?$/i.test(normalized)) return "error";
  if (/^(is)?(loading|pending|busy|submitting)$/i.test(normalized)) return "activate";
  if (/^(is)?success(ful)?$|^succeeded$|^complet(e|ed|ion)$|^done$|^reward(ed)?$/i.test(normalized)) return "success";
  return undefined;
}

/** Typed `data` prop fields + effect source; empty string when no bindings. */
function emitBindingSurface(
  bindings: Array<{ property: string; targetPart: string }>,
  sendExpr: string,
  indent = "  "
): { propsField: string; docNote: string; effectSource: string } {
  if (bindings.length === 0) {
    return { propsField: "", docNote: "", effectSource: "" };
  }
  const wiring = deriveWiring(bindings);
  const driven = wiring
    .filter((entry) => entry.event)
    .map((entry) => `${entry.property} → ${entry.event}`)
    .join(", ");
  const fields = wiring
    .map((entry) => `${entry.property}?: boolean`)
    .join(";\n    ");
  const propsField = "\n    data?: {\n    " + fields + "\n    };";
  const docNote = driven ? `\n * Data bindings: ${driven}.` : "";
  if (!driven) {
    return { propsField, docNote, effectSource: "" };
  }
  const checks = wiring
    .filter((entry) => entry.event)
    .map((entry) =>
      `${indent}    if (data.${entry.property}) { ${sendExpr}(${JSON.stringify(entry.event!)}); return; }`
    )
    .join("\n");
  const deps = wiring
    .map((entry) => `data?.${entry.property}`)
    .join(", ");
  const effectSource = [
    `${indent}React.useEffect(() => {`,
    `${indent}  if (!data) return;`,
    checks,
    `${indent}  ${sendExpr}("reset");`,
    `${indent}}, [${deps}, ${sendExpr}]);`
  ].join("\n");
  return {
    propsField,
    docNote,
    effectSource: `\n${effectSource}`
  };
}

// ---------------------------------------------------------------------------
// SVG component emitter
// ---------------------------------------------------------------------------

function emitAnimatedSvgComponent(
  componentName: string,
  input: ReactEmitterInput
): string {
  const asset = input.asset;
  const scene = input.scene;
  const model = extractSceneModel(scene);
  const nodes = asset?.pathTree?.flatMap(flattenNodes).filter((node) =>
    ["path", "circle", "rect", "ellipse", "polygon", "polyline", "line"].includes(node.tag)
  ).slice(0, 24) ?? [];
  const viewBox = asset?.dimensions?.viewBox ?? "0 0 160 160";
  const width = asset?.dimensions?.width ?? 120;
  const height = asset?.dimensions?.height ?? 120;

  const stateUnion = model
    ? model.states.map((state) => JSON.stringify(state)).join(" | ")
    : STANDARD_MOTION_STATES.map((state) => JSON.stringify(state)).join(" | ");
  const initialState = model?.initialState ?? "idle";

  const shapes = nodes.length > 0
    ? nodes.map((node, index) => svgNodeToMotion(node, index)).join("\n")
    : "        <motion.path d=\"M80 18C114 18 142 46 142 80S114 142 80 142 18 114 18 80 46 18 80 18Z\" fill=\"none\" stroke=\"currentColor\" strokeWidth={8} variants={partVariants(0)} />";

  const partTokenLists = nodes.map((node) => [
    node.nodeId,
    node.id ?? "",
    node.semanticLabel ?? "",
    node.roleGuess
  ].filter(Boolean));

  let variantsBlock: string;
  let partVariantsFn: string;
  if (model) {
    const source = emitSceneVariantsSource(model, partTokenLists.length > 0 ? partTokenLists : [["*"]]);
    variantsBlock = [
      source ?? "",
      emitTransitionsSource(model)
    ].filter(Boolean).join("\n\n");
    partVariantsFn = `  const partVariants = (index: number): Variants =>
    PART_VARIANTS[Math.min(index, PART_VARIANTS.length - 1)];`;
  } else {
    variantsBlock = "";
    partVariantsFn = `  const partVariant = (index: number): Variants => ({
    idle: { opacity: 0.88, pathLength: 1, scale: 1, rotate: 0 },
    hover: reducedMotion ? { opacity: 1 } : { opacity: 1, pathLength: 1, scale: 1.012, transition: { ...transition, delay: index * 0.025 } },
    pressed: reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 0.965, transition: { duration: 0.08 } },
    active: reducedMotion ? { opacity: 1 } : { opacity: 1, pathLength: 1, scale: 1.035, transition: { ...transition, delay: index * 0.035 } },
    success: reducedMotion ? { opacity: 1 } : { opacity: 1, scale: [1, 1.08, 1], rotate: [0, 1.5, 0], transition: { duration: 0.62, delay: index * 0.025 } },
    error: reducedMotion ? { opacity: 1 } : { opacity: 1, x: [0, -2, 2, -1, 0], transition: { duration: 0.34 } },
    disabled: { opacity: 0.48, scale: 1 }
  });`;
  }

  const shapesRef = model ? shapes.replace(/partVariant\(/g, "partVariants(") : shapes;

  const bindingNote = scene && scene.bindings.length > 0
    ? `\n * Bindings: ${scene.bindings.map((binding) => `${binding.property}->${binding.targetPart}`).join(", ")}`
    : "";

  const bindingSurface = emitBindingSurface(scene?.bindings ?? [], "send");

  return `"use client";

import * as React from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

type MotionState = ${stateUnion};
type MotionEvent = ${STANDARD_MOTION_EVENTS.map((event) => JSON.stringify(event)).join(" | ")};

const transition = { type: "spring", stiffness: 380, damping: 30 } as const;

${variantsBlock ? `${variantsBlock}\n` : ""}
/**
 * Generated by motion-mcp on ${nowIso()}.
 * Prompt: ${escapeComment(input.planItem.interactionIdea)}
 * Source asset: ${asset?.path ?? "unknown"}${bindingNote}${bindingSurface.docNote}${model ? `\n * Scene state machine: ${model.stateMachineName} (${model.states.join(" → …")})` : "\n * Runtime: host-code state machine + Framer Motion SVG parts."}
 */
export interface ${componentName}Props extends React.SVGProps<SVGSVGElement> {
  active?: boolean;
  motionState?: MotionState;${bindingSurface.propsField}
  onMotionStateChange?: (state: MotionState, event: MotionEvent) => void;
}

export function use${componentName}StateMachine(active = false, controlledState?: MotionState) {
  const [state, setState] = React.useState<MotionState>(active ? "active" : "${initialState}");

  React.useEffect(() => {
    if (controlledState) setState(controlledState);
  }, [controlledState]);

  React.useEffect(() => {
    if (!controlledState) setState(active ? "active" : "${initialState}");
  }, [active, controlledState]);
${
  model
    ? sceneSendFunctionSource(model)
    : `  const send = React.useCallback((event: MotionEvent) => {
    setState((current) => {
      if (current === "disabled") return current;
      switch (event) {
        case "pointerEnter": return current === "active" ? "active" : "hover";
        case "pointerLeave": return active ? "active" : "idle";
        case "pressIn": return "pressed";
        case "pressOut": return active ? "active" : "hover";
        case "activate": return "active";
        case "success": return "success";
        case "error": return "error";
        case "reset": return "idle";
        default: return current;
      }
    });
  }, [active]);`
}

  return { state: controlledState ?? state, send };
}

export function ${componentName}({
  active = false,
  motionState,
  data,
  onMotionStateChange,
  ...props
}: ${componentName}Props) {
  const reducedMotion = useReducedMotion();
  const { state, send } = use${componentName}StateMachine(active, motionState);

  const emit = (event: MotionEvent) => {
    send(event);
    onMotionStateChange?.(state, event);
  };
${bindingSurface.effectSource}

${partVariantsFn}

  return (
    <motion.svg
      viewBox="${viewBox}"
      width={${JSON.stringify(width)}}
      height={${JSON.stringify(height)}}
      role="img"
      aria-label={${JSON.stringify(scene?.semantics?.label ?? input.planItem.interactionIdea.slice(0, 80))}}
      initial={false}
      animate={state}
      onPointerEnter={() => emit("pointerEnter")}
      onPointerLeave={() => emit("pointerLeave")}
      onPointerDown={() => emit("pressIn")}
      onPointerUp={() => emit("pressOut")}
      transition={reducedMotion ? { duration: 0 } : transition}
      style={reducedMotion ? { transform: "none" } : undefined}
      {...props}
    >
${shapesRef}
    </motion.svg>
  );
}

export default ${componentName};
`;
}

function emitMotionEnhancerComponent(
  componentName: string,
  input: ReactEmitterInput
): string {
  const scene = input.scene;
  const model = extractSceneModel(scene);
  const stateUnion = model
    ? model.states.map((state) => JSON.stringify(state)).join(" | ")
    : STANDARD_MOTION_STATES.map((state) => JSON.stringify(state)).join(" | ");
  const initialState = model?.initialState ?? "idle";

  let containerVariants: string;
  if (model) {
    const perState: Record<string, VariantLiteral> = {};
    for (const stateName of model.states) {
      const clip = model.clips[stateName];
      perState[stateName] = clip ? buildVariantLiteral(clip, ["*"]) : {};
    }
    containerVariants = `const CONTAINER_VARIANTS = ${JSON.stringify(perState, null, 2)} as const;`;
  } else {
    containerVariants = "";
  }

  const variantsExpr = model
    ? "CONTAINER_VARIANTS"
    : `{
        idle: { scale: 1, y: 0, filter: "drop-shadow(0 0 0 rgba(91, 124, 250, 0))" },
        hover: reducedMotion ? {} : { scale: 1.018, y: -2, filter: "drop-shadow(0 10px 24px rgba(91, 124, 250, 0.18))" },
        pressed: reducedMotion ? {} : { scale: 0.985, y: 0 },
        active: reducedMotion ? {} : { scale: 1.015, y: -2, filter: "drop-shadow(0 10px 24px rgba(91, 124, 250, 0.24))" },
        success: reducedMotion ? {} : { scale: [1, 1.04, 1], y: [0, -3, 0] },
        error: reducedMotion ? {} : { x: [0, -3, 3, -1, 0] },
        disabled: { opacity: 0.5 }
      }`;

  const sendImpl = model
    ? `  const send = React.useCallback((event: string) => {
    if (motionState) return;
    setState((current) => {
      const next = SCENE_TRANSITIONS[current]?.[event] ?? SCENE_TRANSITIONS["*"]?.[event];
      if (next) return next as MotionState;
      return current;
    });
  }, [motionState]);`
    : `  const send = React.useCallback((event: MotionEvent) => {
    if (motionState) return;
    if (event === "pointerEnter") setLocalState(active ? "active" : "hover");
    if (event === "pointerLeave") setLocalState(active ? "active" : "idle");
    if (event === "pressIn") setLocalState("pressed");
    if (event === "pressOut") setLocalState(active ? "active" : "hover");
    if (event === "activate") setLocalState("active");
    if (event === "success") setLocalState("success");
    if (event === "error") setLocalState("error");
    if (event === "reset") setLocalState("idle");
  }, [active, motionState]);`;

  const bindingSurface = emitBindingSurface(scene?.bindings ?? [], "send");

  return `"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

type MotionState = ${stateUnion};
type MotionEvent = ${STANDARD_MOTION_EVENTS.map((event) => JSON.stringify(event)).join(" | ")};

${containerVariants ? `${containerVariants}\n\n${emitTransitionsSource(model!)}\n` : ""}
/**
 * Generated by motion-mcp on ${nowIso()}.
 * Prompt: ${escapeComment(input.planItem.interactionIdea)}
 * Runtime: host-code state machine + Framer Motion wrapper.${model ? `\n * Scene state machine: ${model.stateMachineName}.` : ""}${bindingSurface.docNote}
 */
export interface ${componentName}Props {
  children: React.ReactNode;
  active?: boolean;
  motionState?: MotionState;${bindingSurface.propsField}
  className?: string;
}

export function ${componentName}({ children, active = false, motionState, data, className }: ${componentName}Props) {
  const reducedMotion = useReducedMotion();
  const [localState, setLocalState] = React.useState<MotionState>(active ? "active" : "${initialState}");
  const state = motionState ?? localState;
${sendImpl}${bindingSurface.effectSource}

  return (
    <motion.div
      className={className}
      initial={false}
      animate={state}
      variants=${variantsExpr}
      onPointerEnter={() => send("pointerEnter")}
      onPointerLeave={() => send("pointerLeave")}
      onPointerDown={() => send("pressIn")}
      onPointerUp={() => send("pressOut")}
      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }}
    >
      {children}
    </motion.div>
  );
}

export default ${componentName};
`;
}

function svgNodeToMotion(node: { tag: string; attrs: Record<string, string>; semanticLabel?: string; roleGuess: string }, index: number): string {
  const tagName = `motion.${node.tag}`;
  const attrs = Object.entries(node.attrs)
    .filter(([key]) => !["id", "class", "data-name"].includes(key))
    .map(([key, value]) => `${camelSvgAttr(key)}=${JSON.stringify(sanitizeSvgValue(value))}`)
    .join(" ");
  const label = node.semanticLabel ?? node.roleGuess;
  return `        {/* ${escapeComment(label)} */}
        <${tagName} ${attrs} variants={partVariants(${index})} />`;
}

function flattenNodes<T extends { children: T[] }>(node: T): T[] {
  return [node, ...node.children.flatMap(flattenNodes)];
}

function camelSvgAttr(attr: string): string {
  return attr.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function sanitizeSvgValue(value: string): string {
  if (/^url\(#/.test(value)) return "currentColor";
  return value;
}

function safeComponentName(file: string): string {
  const base = path.basename(file, path.extname(file));
  const pascal = base
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return `Motion${pascal || "Generated"}`;
}

function escapeComment(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/\r?\n/g, " ");
}
