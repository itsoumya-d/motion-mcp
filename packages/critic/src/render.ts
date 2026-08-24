import { decodePng, renderSceneFrames } from "@motion-mcp/capture";
import type { SceneDoc } from "@motion-mcp/scene-graph";
import {
  analyzeSceneMotion,
  scoreChecks,
  type CritiqueCheck,
  type MotionCritique
} from "./checks.js";
import { lintCurves } from "./curve-lint.js";
import { resolveJudgeProvider, type DecodedFrameInput, type JudgeContext } from "./judge.js";
import { DEFAULT_RUBRIC, checkConfig, type MotionRubric } from "./rubric.js";

export interface RenderCritiqueOptions {
  state?: string;
  fps?: number;
  /** Sample count for raster checks. Default 6. */
  maxFrames?: number;
  width?: number;
}

/** Full-critique options: rubric-driven, with an optional vision judge. */
export interface CritiqueOptions extends RenderCritiqueOptions {
  rubric?: MotionRubric;
  /** Vision judge; defaults to the rubric's provider (mock). Pass `false` to disable judging. */
  judge?: import("./judge.js").JudgeProvider | false;
  judgeContext?: JudgeContext;
  skipRender?: boolean;
}

export interface RenderCheckResult {
  checks: CritiqueCheck[];
  frames: number;
}

/**
 * Raster-level critique: renders the state headlessly and inspects sampled
 * PNG frames for static output (identical frames) and blank output
 * (near-uniform color). Complements the structural checks with evidence the
 * math alone cannot see — most commonly tracks that target part ids which
 * do not exist in the source SVG.
 */
export async function critiqueRenderedOutput(
  doc: SceneDoc,
  options: RenderCritiqueOptions & { rubric?: MotionRubric } = {}
): Promise<RenderCheckResult> {
  const rubric = options.rubric ?? DEFAULT_RUBRIC;
  const maxFrames = Math.min(Math.max(options.maxFrames ?? rubric.render.maxFrames, 2), 24);
  const fps = options.fps ?? spreadFps(doc, options.state ?? "play", maxFrames);
  const { frames } = await renderSceneFrames(doc, {
    state: options.state,
    fps,
    maxFrames,
    width: options.width
  });
  if (frames.length === 0) {
    return { checks: filterEmit(rubric, [{ id: "render-static", severity: "fail", message: "Renderer produced no frames." }]), frames: 0 };
  }
  const decodedFrames = frames.map((frame) => decodePng(frame.png));
  return {
    checks: rasterChecks(doc, decodedFrames, frames.length, rubric),
    frames: frames.length
  };
}

/**
 * Full C1 review: structural analysis + curve lint + headless render critique
 * + vision-judge pass — all configured by the rubric. One render pass feeds
 * both the raster checks and the judge.
 */
export async function critiqueScene(doc: SceneDoc, options: CritiqueOptions = {}): Promise<MotionCritique> {
  const rubric = options.rubric ?? DEFAULT_RUBRIC;

  const structural = analyzeSceneMotion(doc, rubric);
  const curve = lintCurves(doc, rubric);
  let checks: CritiqueCheck[] = [...structural.checks, ...curve.checks];
  if (options.skipRender) {
    return scoreChecks(checks, rubric);
  }

  let decodedFrames: DecodedFrameInput[] = [];
  try {
    const maxFrames = Math.min(Math.max(options.maxFrames ?? rubric.render.maxFrames, 2), 24);
    const fps = options.fps ?? spreadFps(doc, options.state ?? "play", maxFrames);
    const { frames } = await renderSceneFrames(doc, {
      state: options.state,
      fps,
      maxFrames,
      width: options.width
    });
    decodedFrames = frames.map((frame) => decodePng(frame.png));
    checks.push(...rasterChecks(doc, decodedFrames, frames.length, rubric));
  } catch (error) {
    checks.push({
      id: "render-static",
      severity: "warn" as const,
      message: `Render check skipped: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  if (options.judge !== false && checkConfig(rubric, "judge-aliveness").enabled) {
    checks.push(await judgeCheck(decodedFrames, options, rubric, options.judge ?? resolveJudgeProvider(rubric.judge)));
  }

  return scoreChecks(checks, rubric);
}

async function judgeCheck(
  decodedFrames: DecodedFrameInput[],
  options: CritiqueOptions,
  rubric: MotionRubric,
  provider: import("./judge.js").JudgeProvider
): Promise<CritiqueCheck> {
  const config = checkConfig(rubric, "judge-aliveness");
  try {
    if (decodedFrames.length < 2) {
      return {
        id: "judge-aliveness",
        severity: "pass",
        message: "Judge skipped: fewer than two rendered frames."
      };
    }
    const result = await provider.judge(decodedFrames, options.judgeContext ?? {});
    return {
      id: "judge-aliveness",
      severity: result.passes ? "pass" : config.severity ?? "fail",
      message: result.passes
        ? `Vision judge (${result.provider}) aliveness ${result.alivenessScore}/100 ≥ threshold ${rubric.judge.alivenessThreshold}.`
        : `Vision judge (${result.provider}) aliveness ${result.alivenessScore}/100 < threshold ${rubric.judge.alivenessThreshold}: ${result.notes.join(" ")}`,
      evidence: `${result.provider}:${result.alivenessScore}`
    };
  } catch (error) {
    return {
      id: "judge-aliveness",
      severity: "warn",
      message: `Vision judge unavailable: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function rasterChecks(
  doc: SceneDoc,
  decodedFrames: DecodedFrameInput[],
  frameCount: number,
  rubric: MotionRubric
): CritiqueCheck[] {
  if (frameCount === 0) {
    return filterEmit(rubric, [
      { id: "render-static", severity: "fail", message: "Renderer produced no frames." }
    ]);
  }
  const checks: CritiqueCheck[] = [];
  const maxPairwiseDiff = maxConsecutiveDiff(decodedFrames.map((decoded) => decoded.rgba));
  if (maxPairwiseDiff < rubric.render.staticDiffEpsilon && frameCount >= 3) {
    // Hold-only clips legitimately produce identical frames; anything else
    // indicates tracks that never touch the artwork.
    const hasAnimationKeys = hasNonHoldTracks(doc);
    if (!hasAnimationKeys) {
      checks.push({
        id: "render-static",
        severity: "pass",
        message: "Frames are static by design (hold keys only)."
      });
    } else {
      checks.push(
        ...(filterEmit(rubric, [
          {
            id: "render-static",
            severity: "fail",
            message: `All ${frameCount} sampled frames are pixel-identical — tracks likely target missing part ids.`,
            evidence: `max channel delta ${maxPairwiseDiff}`
          }
        ]) as CritiqueCheck[])
      );
    }
  }

  const blank = decodedFrames.filter((decoded) => isNearUniform(decoded.rgba));
  if (blank.length === frameCount) {
    checks.push(
      ...(filterEmit(rubric, [
        {
          id: "render-blank",
          severity: "fail",
          message: "Every sampled frame renders near-uniform (blank).",
          evidence: `${blank.length}/${frameCount} blank`
        }
      ]) as CritiqueCheck[])
    );
  }

  return checks;
}

/** Applies rubric enablement/severity to candidate findings. */
function filterEmit(
  rubric: MotionRubric,
  candidates: Array<CritiqueCheck & { severity: "fail" | "warn" }>
): CritiqueCheck[] {
  const out: CritiqueCheck[] = [];
  for (const candidate of candidates) {
    const config = checkConfig(rubric, candidate.id);
    if (!config.enabled) continue;
    out.push({ ...candidate, severity: config.severity ?? candidate.severity });
  }
  return out;
}

function hasNonHoldTracks(doc: SceneDoc): boolean {
  return doc.artboards.some((artboard) =>
    Object.values(artboard.clips).some((clip) =>
      clip.tracks.some((track) =>
        track.keys.some((key) => key.easing !== "hold") ||
        new Set(track.keys.map((key) => key.value)).size > 1
      )
    )
  );
}

/**
 * Chooses an fps that spreads maxFrames across the target state's whole
 * clip duration (e.g. a 3400ms breathe at 6 samples → fps=2).
 */
function spreadFps(doc: SceneDoc, stateName: string, maxFrames: number): number {
  const artboard = doc.artboards[0];
  const machine = artboard?.stateMachines[0];
  const normalized = stateName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const state =
    machine?.states.find((candidate) => candidate.name.toLowerCase() === stateName.toLowerCase()) ??
    machine?.states.find(
      (candidate) => candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized
    ) ??
    machine?.states[0];
  const durationMs = state?.clipId ? artboard!.clips[state.clipId]?.durationMs : undefined;
  if (!durationMs || durationMs <= 0) return Math.max(1, Math.min(20, maxFrames));
  const fps = Math.round((maxFrames * 1000) / durationMs);
  return Math.max(1, Math.min(60, fps));
}

/** Mean per-channel difference between consecutive strided frames. */
function maxConsecutiveDiff(rgbas: Uint8Array[]): number {
  if (rgbas.length < 2) return 0;
  let worst = 0;
  for (let index = 1; index < rgbas.length; index += 1) {
    const a = rgbas[index - 1]!;
    const b = rgbas[index]!;
    const stride = Math.max(4, Math.floor(a.length / 20000) * 4);
    let sum = 0;
    let samples = 0;
    for (let offset = 0; offset + 2 < a.length; offset += stride) {
      sum += Math.abs(a[offset]! - b[offset]!) + Math.abs(a[offset + 1]! - b[offset + 1]!) + Math.abs(a[offset + 2]! - b[offset + 2]!);
      samples += 3;
    }
    const mean = sum / Math.max(1, samples);
    if (mean > worst) worst = mean;
  }
  return worst;
}

function isNearUniform(rgba: Uint8Array, tolerance = 6): boolean {
  if (rgba.length < 4) return true;
  const baseR = rgba[0]!;
  const baseG = rgba[1]!;
  const baseB = rgba[2]!;
  const stride = Math.max(4, Math.floor(rgba.length / 4000) * 4);
  for (let offset = 0; offset < rgba.length; offset += stride) {
    if (
      Math.abs(rgba[offset]! - baseR) > tolerance ||
      Math.abs(rgba[offset + 1]! - baseG) > tolerance ||
      Math.abs(rgba[offset + 2]! - baseB) > tolerance
    ) {
      return false;
    }
  }
  return true;
}
