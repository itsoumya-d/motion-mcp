import type { SceneDoc } from "@motion-mcp/scene-graph";
import {
  SCENE_FORMAT_VERSION,
  resolveTemperament,
  temperamentProfile,
  validateSceneDoc,
  type SceneArtboard,
  type SceneClip,
  type SceneTemperament,
  type TemperamentMotionProfile
} from "@motion-mcp/scene-graph";
import { analyzeSceneMotion, lintCurves } from "@motion-mcp/critic";
import type { CritiqueCheck } from "@motion-mcp/critic";
import { parseMotionPrompt, type MotionIntent, type ParsedPrompt } from "./intent.js";
import { synthesizeClip } from "./synth.js";

export interface GenerateFromPromptInput {
  prompt: string;
  temperament?: string | Partial<SceneTemperament>;
  /** Part ids the motion should drive. Defaults to ["*"] (whole artboard). */
  parts?: string[];
  sceneId?: string;
  name?: string;
  /** Attached so downstream review/export can rasterize without extra context. */
  sourceSvg?: string;
}

export interface SelfCheckReport {
  schemaValid: boolean;
  schemaErrors: string[];
  ok: boolean;
  score: number;
  summary: string;
  checks: CritiqueCheck[];
  fixes: string[];
}

export interface GenerationResult {
  doc: SceneDoc;
  parsed: ParsedPrompt;
  profile: TemperamentMotionProfile;
  notes: string[];
  selfCheck: SelfCheckReport;
}

/**
 * Prompt → validated SceneDoc, fully offline and deterministic:
 *
 *   lexicon parse → temperament profile → procedural recipes → state machine
 *   assembly → schema validation → structural critique + curve lint
 *
 * The self-check rides inside generation (build-order rule: nothing ships a
 * candidate without a judge). Rendered-frame judging stays available through
 * the critic tools after staging.
 */
export function generateMotionFromPrompt(input: GenerateFromPromptInput): GenerationResult {
  const parsed = parseMotionPrompt(input.prompt);
  const temperament = resolveTemperament(input.temperament);
  const profile = temperamentProfile(temperament);
  const parts = input.parts && input.parts.length > 0 ? input.parts : ["*"];
  const notes: string[] = [];

  if (parsed.primary.action === "pulse" && !/\bpuls|breath|beat|glow/i.test(input.prompt)) {
    notes.push(
      `No known action verb matched ("${truncate(input.prompt)}") — fell back to an ambient pulse. Vocabulary: bounce, spin, shake, pulse, nod, wave, jump, sway, blink, slide.`
    );
  }

  const intents = dedupeIntents(parsed.all, notes);
  const clipIdsByAction = new Map<string, string>();

  const clips: Record<string, SceneClip> = {};
  for (const intent of intents) {
    const merged = mergePartClips(intent, parts, input.temperament);
    clips[merged.clipId] = merged;
    clipIdsByAction.set(intent.action, merged.clipId);
  }

  const states: Array<{
    stateId: string;
    name: string;
    kind: "single";
    clipId: string;
    loop?: boolean;
    controlledParts: string[];
  }> = intents.map((intent) => ({
    stateId: `state_${intent.action}`,
    name: intent.action,
    kind: "single" as const,
    clipId: clipIdsByAction.get(intent.action)!,
    loop: intent.loop,
    controlledParts: [...parts]
  }));
  const primaryStateId = `state_${intents[0]!.action}`;

  let initialStateId = primaryStateId;
  const transitions: Array<{
    transitionId: string;
    fromStateId: string;
    toStateId: string;
    event?: string;
    durationMs: number;
    interpolation: "spring" | "cubic" | "linear" | "hold";
    conditions: never[];
    actions: never[];
  }> = [];

  const hasLoopingState = states.some((state) => state.loop);
  if (!hasLoopingState) {
    const idleClip = synthesizeAmbientIdle(input.temperament, parts);
    clips[idleClip.clipId] = idleClip;
    states.unshift({
      stateId: "state_idle",
      name: "idle",
      kind: "single",
      clipId: idleClip.clipId,
      loop: true,
      controlledParts: [...parts]
    });
    initialStateId = "state_idle";
    for (const state of states.filter((candidate) => candidate.stateId !== "state_idle")) {
      transitions.push({
        transitionId: `transition_idle_${state.stateId}`,
        fromStateId: "state_idle",
        toStateId: state.stateId,
        event: "activate",
        durationMs: Math.round(220 * profile.durationScale),
        interpolation: profile.preferredEasing === "easeOut" ? "spring" : "cubic",
        conditions: [],
        actions: []
      });
    }
    notes.push("No looping state in the prompt — added an idle pulse as the entry state with activate-triggered transitions.");
  }

  const artboard: SceneArtboard = {
    artboardId: "generated",
    name: input.name ?? "prompt-generated motion",
    layers: [
      {
        layerId: "layer_main",
        name: "main",
        order: 0,
        targetParts: [...parts],
        initialStateId
      }
    ],
    clips,
    stateMachines: [
      {
        stateMachineId: "generated:machine",
        name: "Generated",
        initialStateId,
        layerId: "layer_main",
        states,
        transitions
      }
    ],
    bindings: [],
    listeners: [],
    audioEvents: [],
    semantics: { reducedMotionSafe: true, label: input.name ?? "generated motion" },
    temperament
  };
  if (input.sourceSvg) {
    (artboard as { sourceSvg?: string }).sourceSvg = input.sourceSvg;
  }

  const doc: SceneDoc = {
    formatVersion: SCENE_FORMAT_VERSION,
    sceneId: input.sceneId ?? `scene_generated_${Date.now()}`,
    name: input.name ?? "prompt-generated motion",
    createdAt: new Date().toISOString(),
    canvas: undefined,
    artboards: [artboard]
  };

  return {
    doc,
    parsed,
    profile,
    notes,
    selfCheck: runSelfCheck(doc)
  };
}

function dedupeIntents(intents: MotionIntent[], notes: string[]): MotionIntent[] {
  const seen = new Set<string>();
  const out: MotionIntent[] = [];
  for (const intent of intents) {
    if (seen.has(intent.action)) continue;
    seen.add(intent.action);
    if (intent.action === "spin" && intent.loop) {
      out.push({ ...intent, loop: false });
      notes.push("Spin loops need runtime angle-wrap handling — emitted a single-turn spin instead.");
    } else {
      out.push(intent);
    }
  }
  return out.sort((a, b) => Number(b.loop) - Number(a.loop));
}

/** One clip per action whose tracks cover every part with stagger offsets. */
function mergePartClips(
  intent: MotionIntent,
  parts: string[],
  temperament: string | Partial<SceneTemperament> | undefined
): SceneClip {
  const perPart = parts.map((part, index) =>
    synthesizeClip(intent, { temperament, part, partIndex: index })
  );
  const tracks = perPart.flatMap((clip) => clip.tracks);
  const durationMs = perPart.reduce((max, clip) => Math.max(max, clip.durationMs), 0);
  const loop = perPart.every((clip) => clip.loop);
  return {
    clipId: perPart[0]!.clipId,
    name: perPart[0]!.name,
    durationMs,
    loop,
    tracks
  };
}

function synthesizeAmbientIdle(
  temperament: string | Partial<SceneTemperament> | undefined,
  parts: string[]
): SceneClip {
  const idleIntent: MotionIntent = { action: "pulse", loop: true };
  const perPart = parts.map((part, index) =>
    synthesizeClip(idleIntent, { temperament, part, partIndex: index })
  );
  return {
    clipId: "clip-idle",
    name: "idle",
    durationMs: perPart.reduce((max, clip) => Math.max(max, clip.durationMs), 0),
    loop: true,
    tracks: perPart.flatMap((clip) => clip.tracks)
  };
}

function runSelfCheck(doc: SceneDoc): SelfCheckReport {
  const validation = validateSceneDoc(doc);
  const structural = analyzeSceneMotion(doc);
  const curve = lintCurves(doc);
  const checks = [...structural.checks, ...curve.checks];
  const fails = checks.filter((check) => check.severity === "fail").length;
  const warns = checks.filter((check) => check.severity === "warn").length;
  return {
    schemaValid: validation.ok,
    schemaErrors: validation.errors,
    ok: validation.ok && fails === 0,
    score: Math.max(0, structural.score - warns * 8),
    summary:
      `${fails} fail${fails === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"} ` +
      `(structural + curve lint; rendered-frame judging available post-staging).`,
    checks,
    fixes: [...structural.fixes, ...curve.fixes]
  };
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}
