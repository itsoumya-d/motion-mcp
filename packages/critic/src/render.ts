import { decodePng, renderSceneFrames } from "@motion-mcp/capture";
import type { SceneDoc } from "@motion-mcp/scene-graph";
import {
  analyzeSceneMotion,
  scoreChecks,
  type CritiqueCheck,
  type MotionCritique
} from "./checks.js";

export interface RenderCritiqueOptions {
  state?: string;
  fps?: number;
  /** Sample count for raster checks. Default 6. */
  maxFrames?: number;
  width?: number;
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
  options: RenderCritiqueOptions = {}
): Promise<RenderCheckResult> {
  const maxFrames = Math.min(Math.max(options.maxFrames ?? 6, 2), 24);
  // Spread samples across the WHOLE clip: a fixed high fps would only see
  // the first few ms of slow loops and misread them as static.
  const fps = options.fps ?? spreadFps(doc, options.state ?? "play", maxFrames);
  const { frames } = await renderSceneFrames(doc, {
    state: options.state,
    fps,
    maxFrames,
    width: options.width
  });

  const checks: CritiqueCheck[] = [];
  if (frames.length === 0) {
    checks.push({
      id: "render-static",
      severity: "fail",
      message: "Renderer produced no frames."
    });
    return { checks, frames: 0 };
  }

  const decodedFrames = frames.map((frame) => decodePng(frame.png));
  const maxPairwiseDiff = maxConsecutiveDiff(decodedFrames.map((decoded) => decoded.rgba));
  if (maxPairwiseDiff < STATIC_DIFF_EPSILON && frames.length >= 3) {
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
      checks.push({
        id: "render-static",
        severity: "fail",
        message: `All ${frames.length} sampled frames are pixel-identical — tracks likely target missing part ids.`,
        evidence: `max channel delta ${maxPairwiseDiff}`
      });
    }
  }

  const blank = decodedFrames.filter((decoded) => isNearUniform(decoded.rgba));
  if (blank.length === frames.length) {
    checks.push({
      id: "render-blank",
      severity: "fail",
      message: "Every sampled frame renders near-uniform (blank).",
      evidence: `${blank.length}/${frames.length} blank`
    });
  }

  return { checks, frames: frames.length };
}

/**
 * Full C1 review: structural analysis + headless render critique.
 */
export async function critiqueScene(
  doc: SceneDoc,
  options: RenderCritiqueOptions & { skipRender?: boolean } = {}
): Promise<MotionCritique> {
  const structural = analyzeSceneMotion(doc);
  if (options.skipRender) return structural;

  let rendered: RenderCheckResult;
  try {
    rendered = await critiqueRenderedOutput(doc, options);
  } catch (error) {
    return {
      ...structural,
      ok: false,
      checks: [
        ...structural.checks,
        {
          id: "render-static",
          severity: "warn" as const,
          message: `Render check skipped: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }

  const all = [...structural.checks, ...rendered.checks];
  const report = scoreChecks(all);
  const fails = all.filter((check) => check.severity === "fail").length;
  return { ...report, ok: fails === 0 };
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

/** Below this mean channel delta, consecutive frames count as identical. */
const STATIC_DIFF_EPSILON = 0.05;

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
