import type {
  SceneArtboard,
  SceneClip,
  SceneDoc,
  SceneKeyframe,
  SceneTrack
} from "@motion-mcp/scene-graph";

/** Flat frame: part id -> property -> sampled value. */
export type Frame = Record<string, Record<string, number | string | number[]>>;

export interface PlayerOptions {
  artboardId?: string;
  /** When true, animated tracks resolve to their terminal values immediately. */
  reducedMotion?: boolean;
}

/**
 * Renderer-agnostic SceneDoc player.
 *
 * Owns the state machine (transitions incl. wildcard edges) and samples the
 * active state's clip deterministically via `seek(ms)`. No DOM, no rAF — the
 * host drives time, which makes it trivially testable and embeddable
 * anywhere TS runs (web component, RN, node capture).
 */
export class ScenePlayer {
  readonly artboard: SceneArtboard;
  private machineIndex: number;
  private currentStateName: string;
  private options: PlayerOptions;
  private elapsedMs = 0;

  constructor(doc: SceneDoc, options: PlayerOptions = {}) {
    const index = options.artboardId
      ? doc.artboards.findIndex((artboard) => artboard.artboardId === options.artboardId)
      : 0;
    if (index === -1) {
      throw new Error(`artboard ${options.artboardId} not found in scene ${doc.sceneId}`);
    }
    this.artboard = doc.artboards[index]!;
    this.machineIndex = 0;
    const machine = this.machine;
    this.currentStateName = machine
      ? normalize(this.nameOf(machine.initialStateId) ?? "idle")
      : "idle";
    this.options = options;
  }

  private get machine() {
    return this.artboard.stateMachines[this.machineIndex] ?? null;
  }

  private nameOf(stateId: string): string | undefined {
    return this.machine?.states.find((state) => state.stateId === stateId)?.name;
  }

  private idOf(stateName: string): string | undefined {
    return this.machine?.states.find(
      (state) => normalize(state.name) === normalize(stateName)
    )?.stateId;
  }

  get states(): string[] {
    return (this.machine?.states ?? []).map((state) => normalize(state.name));
  }

  get state(): string {
    return this.currentStateName;
  }

  /** Sends an event through the transition graph. Returns true when it landed. */
  send(event: string): boolean {
    const machine = this.machine;
    if (!machine) return false;
    const transitions = machine.transitions.filter((transition) => transition.event === event);
    if (transitions.length === 0) return false;
    const currentId = this.idOf(this.currentStateName);
    const match =
      transitions.find((transition) => transition.fromStateId === currentId) ??
      transitions.find((transition) => transition.fromStateId === "*");
    if (!match) return false;
    const nextName = this.nameOf(match.toStateId);
    if (!nextName) return false;
    this.enterState(nextName);
    return true;
  }

  enterState(stateName: string): void {
    if (!this.idOf(stateName)) {
      throw new Error(`unknown state "${stateName}"`);
    }
    this.currentStateName = normalize(stateName);
    this.elapsedMs = 0;
  }

  reset(): void {
    const initial = this.machine?.initialStateId;
    if (initial) this.currentStateName = normalize(this.nameOf(initial) ?? "idle");
    this.elapsedMs = 0;
  }
  advance(dtMs: number): Frame {
    this.elapsedMs += Math.max(0, dtMs);
    return this.seek(this.elapsedMs);
  }

  /**
   * Deterministic frame for a wall-clock position inside the current state's
   * clip. Looping clips wrap; one-shots clamp to their final keyframe.
   */
  seek(ms: number): Frame {
    const clip = this.activeClip();
    if (!clip) return {};
    const reduced = this.options.reducedMotion ?? false;
    const t = reduced ? clip.durationMs : wrapTime(clip, ms);
    this.elapsedMs = t;
    return sampleClipFrame(clip, reduced, t);
  }

  /** Pure sampler for an arbitrary state at an arbitrary time. */
  sampleAt(stateName: string, ms: number): Frame {
    const stateId = this.idOf(stateName);
    const state = this.machine?.states.find((candidate) => candidate.stateId === stateId);
    const clip = state?.clipId ? this.artboard.clips[state.clipId] : undefined;
    if (!clip) return {};
    const reduced = this.options.reducedMotion ?? false;
    const t = reduced ? clip.durationMs : wrapTime(clip, ms);
    return sampleClipFrame(clip, reduced, t);
  }

  private activeClip(): SceneClip | undefined {
    const stateId = this.idOf(this.currentStateName);
    const state = this.machine?.states.find((candidate) => candidate.stateId === stateId);
    return state?.clipId ? this.artboard.clips[state.clipId] : undefined;
  }
}

export function wrapTime(clip: SceneClip, ms: number): number {
  if (!clip.loop) return Math.min(Math.max(ms, 0), clip.durationMs);
  const wrapped = ms % clip.durationMs;
  return wrapped < 0 ? wrapped + clip.durationMs : wrapped;
}

/** Samples every track of a clip into a flat part->property frame. */
export function sampleClipFrame(clip: SceneClip, reducedMotion: boolean, atTime?: number): Frame {
  const frame: Frame = {};
  const t = atTime ?? (reducedMotion ? clip.durationMs : 0);
  for (const track of clip.tracks) {
    const keys = track.keys;
    let value: number | string | number[];
    if (reducedMotion || keys.length === 0) {
      value = keys.length > 0 ? keys[keys.length - 1]!.value : defaultFor(track.property);
    } else {
      value = sample(track, t);
    }
    const parts = track.targetPart === "*" ? ["*"] : [track.targetPart];
    for (const part of parts) {
      frame[part] = frame[part] ?? {};
      frame[part]![track.property] = value;
    }
  }
  return frame;
}

function sample(track: SceneTrack, ms: number): number | string | number[] {
  const keys = track.keys as SceneKeyframe[];
  if (keys.length === 0) return 0;
  const first = keys[0]!;
  if (keys.length === 1 || ms <= first.t) return first.value;
  const last = keys[keys.length - 1]!;
  if (ms >= last.t) return last.value;
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= ms) lo = mid;
    else hi = mid;
  }
  const k0 = keys[lo]!;
  const k1 = keys[hi]!;
  const span = Math.max(k1.t - k0.t, 1e-6);
  const raw = (ms - k0.t) / span;
  const eased = ease(raw, k1.easing);
  return interpolate(k0.value, k1.value, eased);
}

export function ease(u: number, kind: SceneKeyframe["easing"]): number {
  const x = Math.min(Math.max(u, 0), 1);
  switch (kind) {
    case "hold": return 0;
    case "easeIn": return x * x;
    case "easeOut": return 1 - (1 - x) * (1 - x);
    case "easeInOut": return x * x * (3 - 2 * x);
    case "spring": return 1 - Math.exp(-6 * x) * Math.cos(9 * x) * (1 - x);
    default: return x;
  }
}

function interpolate(
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

function defaultFor(property: string): number | string {
  return property === "opacity" ? 1 : 0;
}

export function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "state";
}
