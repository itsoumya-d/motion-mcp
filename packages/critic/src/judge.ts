import { decodePng } from "@motion-mcp/capture";
import { ClaudeVisionJudge, GeminiVisionJudge } from "./judge-live.js";
import { DEFAULT_RUBRIC, type JudgeRubricConfig } from "./rubric.js";

/** Minimal decoded-frame view the judge consumes (PNG-decoded RGBA). */
export interface DecodedFrameInput {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface JudgeContext {
  /** Original natural-language intent for the motion (may be empty). */
  prompt?: string;
  /** Name of the state/clip being judged. */
  stateName?: string;
  componentId?: string;
  /** Optional reference frames (PNG bytes) to compare against. */
  referencePngs?: Uint8Array[];
}

export interface JudgeVerdict {
  provider: string;
  /** 0-100: does the motion read as alive and intentional. */
  alivenessScore: number;
  notes: string[];
  passes: boolean;
}

export interface JudgeProvider {
  readonly name: string;
  judge(frames: DecodedFrameInput[], context: JudgeContext): Promise<JudgeVerdict>;
}

/**
 * Deterministic offline judge used by default and in tests. Scores decoded
 * frames on three heuristic axes — motion presence, smoothness (low jerk),
 * and richness (how many sampled moments actually move). It is explicitly
 * NOT a model judgment; live Gemini/Claude providers plug into the same
 * interface behind MOTION_MCP_JUDGE_PROVIDER.
 */
export class MockJudgeProvider implements JudgeProvider {
  readonly name = "mock";

  constructor(
    private readonly options: { staticDiffEpsilon?: number; alivenessThreshold?: number } = {}
  ) {}

  async judge(frames: DecodedFrameInput[], context: JudgeContext): Promise<JudgeVerdict> {
    const epsilon = this.options.staticDiffEpsilon ?? DEFAULT_RUBRIC.render.staticDiffEpsilon;
    const threshold = this.options.alivenessThreshold ?? DEFAULT_RUBRIC.judge.alivenessThreshold;
    const deltas = interFrameDeltas(frames);
    const notes: string[] = [
      "Deterministic mock-judge heuristics (presence/smoothness/richness) — not a model judgment."
    ];
    if (context.prompt) notes.push(`Prompt on record (${context.prompt.length} chars); mock ignores semantics.`);

    if (deltas.length === 0) {
      return verdict(this.name, 0, ["No frame pairs to judge."], threshold);
    }

    const movingPairs = deltas.filter((delta) => delta > epsilon);
    const presenceScore = movingPairs.length > 0 ? 40 : 5;

    const meanDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const jerk =
      deltas.length >= 2
        ? deltas.slice(1).reduce((sum, value, index) => sum + Math.abs(value - deltas[index]!), 0) /
          Math.max(1e-9, deltas.length - 1)
        : 0;
    const relativeJerk = jerk / Math.max(meanDelta, 1e-9);
    const smoothnessScore = Math.round(35 * clamp01(1 - relativeJerk / 2));

    const richnessScore = Math.round((movingPairs.length / deltas.length) * 25);

    const score = Math.min(100, presenceScore + smoothnessScore + richnessScore);
    if (movingPairs.length === 0) notes.push("All sampled frames are visually identical.");
    else notes.push(`${movingPairs.length}/${deltas.length} sampled pairs moved beyond ε=${epsilon}.`);
    notes.push(`Relative jerk ${relativeJerk.toFixed(3)} → smoothness ${smoothnessScore}/35.`);

    return verdict(this.name, score, notes, threshold);
  }
}

export function resolveJudgeProvider(config: JudgeRubricConfig = DEFAULT_RUBRIC.judge): JudgeProvider {
  switch (config.provider) {
    case "mock":
      return new MockJudgeProvider({
        staticDiffEpsilon: DEFAULT_RUBRIC.render.staticDiffEpsilon,
        alivenessThreshold: config.alivenessThreshold
      });
    case "gemini":
      return new GeminiVisionJudge({ threshold: config.alivenessThreshold });
    case "claude":
      return new ClaudeVisionJudge({ threshold: config.alivenessThreshold });
    default:
      return new MockJudgeProvider();
  }
}

/** Renders PNG bytes then judges them through the given provider. */
export async function judgeRenderedFrames(
  pngs: Uint8Array[],
  provider: JudgeProvider,
  context: JudgeContext
): Promise<JudgeVerdict> {
  const decoded: DecodedFrameInput[] = pngs.map((png) => decodePng(png));
  return provider.judge(decoded, context);
}

function interFrameDeltas(frames: DecodedFrameInput[]): number[] {
  const deltas: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    deltas.push(meanChannelDelta(frames[index - 1]!.rgba, frames[index]!.rgba));
  }
  return deltas;
}

function meanChannelDelta(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length < 4) return 0;
  const stride = Math.max(4, Math.floor(a.length / 20000) * 4);
  let sum = 0;
  let samples = 0;
  for (let offset = 0; offset + 2 < a.length; offset += stride) {
    sum +=
      Math.abs(a[offset]! - b[offset]!) +
      Math.abs(a[offset + 1]! - b[offset + 1]!) +
      Math.abs(a[offset + 2]! - b[offset + 2]!);
    samples += 3;
  }
  return sum / Math.max(1, samples);
}

function verdict(
  provider: string,
  score: number,
  notes: string[],
  threshold: number
): JudgeVerdict {
  return { provider, alivenessScore: score, notes, passes: score >= threshold };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
