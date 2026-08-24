import type { SceneArtboard, SceneClip, SceneDoc, SceneTrack } from "@motion-mcp/scene-graph";
import { checkConfig, DEFAULT_RUBRIC, type MotionRubric } from "./rubric.js";

export type CritiqueSeverity = "fail" | "warn" | "pass";

export interface CritiqueCheck {
  id: string;
  severity: CritiqueSeverity;
  message: string;
  /** Track/clip/part the finding refers to. */
  evidence?: string;
}

export interface MotionCritique {
  /** No failed checks. */
  ok: boolean;
  /** 0-100; 100 minus weighted penalties for warns/fails. */
  score: number;
  checks: CritiqueCheck[];
  /** Deterministic, actionable remediation guidance. */
  fixes: string[];
  summary: string;
}

export function scoreChecks(checks: CritiqueCheck[], rubric: MotionRubric = DEFAULT_RUBRIC): MotionCritique {
  let score = 100;
  const fixes: string[] = [];
  for (const check of checks) {
    if (check.severity === "fail") {
      score -= rubric.scoring.failPenalty;
      fixes.push(fixFor(check));
    } else if (check.severity === "warn") {
      score -= rubric.scoring.warnPenalty;
      fixes.push(fixFor(check));
    }
  }
  score = Math.max(0, Math.min(100, score));
  const fails = checks.filter((check) => check.severity === "fail").length;
  const warns = checks.filter((check) => check.severity === "warn").length;
  return {
    ok: fails === 0,
    score,
    checks,
    fixes,
    summary:
      fails > 0
        ? `${fails} blocking issue${fails === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}.`
        : warns > 0
          ? `No blockers; ${warns} polish suggestion${warns === 1 ? "" : "s"}.`
          : "All motion-quality checks passed."
  };
}

const FIX_TEMPLATES: Record<string, (check: CritiqueCheck) => string> = {
  "clip-exists": () => "Compile the experience or pick a state that has a clip before reviewing.",
  "keys-sorted": (check) => `Sort keyframes by time on ${check.evidence ?? "the track"}; unsorted keys break sampling.`,
  "value-bounds": (check) => `Clamp out-of-range values on ${check.evidence ?? "the track"} (opacity 0-1, scale 0.05-5).`,
  "loop-seam": (check) => `Append a wrap key matching the first value at durationMs on ${check.evidence ?? "the track"} so the loop is seamless.`,
  "duration-sane": () => "Set a positive, sane durationMs (1ms-60s) on the clip.",
  "track-span": (check) => `Trim keys beyond clip.durationMs on ${check.evidence ?? "the track"}.`,
  "micro-jitter": (check) => `Reduce alternating micro-movement on ${check.evidence ?? "the track"}; amplitude below 2px reads as noise.`,
  "reduced-motion": () => "Mark semantics.reducedMotionSafe and provide a reduced variant for large-amplitude loops.",
  "render-static": () => "The rendered frames are identical — check that tracks target parts that exist in the source SVG ids.",
  "render-blank": () => "Frames render blank — verify sourceSvg is attached to the artboard and fills are not fully transparent.",
  "easing-mechanical": (check) => `Replace linear easing with easeOut/easeInOut on ${check.evidence ?? "the track"} so motion accelerates and settles naturally.`,
  "velocity-discontinuity": (check) => `Smooth the velocity jump before the flagged key on ${check.evidence ?? "the track"} by adding an intermediate key or fixing units.`,
  "judge-aliveness": (check) => check.message
};

function fixFor(check: CritiqueCheck): string {
  const template = FIX_TEMPLATES[check.id];
  return template ? template(check) : check.message;
}

// ---------------------------------------------------------------------------
// Structural critique (pure — no rendering required)
// ---------------------------------------------------------------------------

interface BoundsRule {
  property: RegExp;
  min: number;
  max: number;
  label: string;
}

function boundsRules(rubric: MotionRubric): BoundsRule[] {
  return rubric.bounds.map((rule) => ({
    property: new RegExp(rule.property),
    min: rule.min,
    max: rule.max,
    label: rule.label
  }));
}

/**
 * Deterministic structural review of one artboard's clips.
 * Pure math over SceneDoc — no rasterization, safe to run anywhere.
 */
export function analyzeArtboardMotion(
  artboard: SceneArtboard,
  rubric: MotionRubric = DEFAULT_RUBRIC
): MotionCritique {
  const checks: CritiqueCheck[] = [];
  const clipIds = Object.keys(artboard.clips);

  if (clipIds.length === 0) {
    push(checks, emit(rubric, { id: "clip-exists", severity: "fail", message: "Artboard has no compiled clips." }));
    return scoreChecks(checks, rubric);
  }

  for (const clipId of clipIds) {
    const clip = artboard.clips[clipId]!;
    checks.push(...critiqueClip(clip, rubric));
  }

  if (artboard.semantics?.reducedMotionSafe !== true) {
    const hasLargeAmplitude = clipIds.some((clipId) =>
      artboard.clips[clipId]!.tracks.some((track) => amplitudeOf(track) > LARGE_AMPLITUDE)
    );
    if (hasLargeAmplitude) {
      push(checks, emit(rubric, {
        id: "reduced-motion",
        severity: "warn",
        message: "Large-amplitude loops exist without semantics.reducedMotionSafe."
      }));
    } else {
      checks.push({
        id: "reduced-motion",
        severity: "pass",
        message: "Reduced-motion exposure is low."
      });
    }
  }

  return scoreChecks(checks, rubric);
}

/** Applies rubric enablement/severity; disabled checks emit nothing. */
function emit(
  rubric: MotionRubric,
  candidate: CritiqueCheck & { severity: "fail" | "warn" }
): CritiqueCheck | null {
  const config = checkConfig(rubric, candidate.id);
  if (!config.enabled) return null;
  return { ...candidate, severity: config.severity ?? candidate.severity };
}

const LARGE_AMPLITUDE = 20;

function critiqueClip(clip: SceneClip, rubric: MotionRubric): CritiqueCheck[] {
  const checks: CritiqueCheck[] = [];

  if (!(clip.durationMs > 0 && clip.durationMs <= 60000)) {
    const check = emit(rubric, {
      id: "duration-sane",
      severity: "fail",
      message: `Clip "${clip.name}" has an invalid durationMs (${clip.durationMs}).`
    });
    if (check) checks.push(check);
  }

  if (clip.tracks.length === 0) {
    const check = emit(rubric, {
      id: "clip-exists",
      severity: "fail",
      message: `Clip "${clip.name}" has no tracks.`,
      evidence: clip.clipId
    });
    if (check) checks.push(check);
    return checks;
  }

  for (const track of clip.tracks) {
    const evidence = `${clip.name}:${track.targetPart}.${track.property}`;
    checks.push(...critiqueTrack(track, clip, evidence, rubric));
  }

  return checks;
}

function critiqueTrack(track: SceneTrack, clip: SceneClip, evidence: string, rubric: MotionRubric): CritiqueCheck[] {
  const checks: CritiqueCheck[] = [];

  // Key ordering / duplicates
  let unsorted = false;
  let duplicate = false;
  for (let i = 1; i < track.keys.length; i += 1) {
    const previous = track.keys[i - 1]!.t;
    const current = track.keys[i]!.t;
    if (current < previous) unsorted = true;
    if (current === previous) duplicate = true;
  }
  if (unsorted) {
    push(checks, emit(rubric, {
      id: "keys-sorted",
      severity: "fail",
      message: `Keys are not time-sorted on ${evidence}.`,
      evidence
    }));
  }
  if (duplicate && !unsorted) {
    push(checks, emit(rubric, {
      id: "keys-sorted",
      severity: "warn",
      message: `Duplicate key times on ${evidence}; later key wins when sampled.`,
      evidence
    }));
  }

  // Value bounds
  for (const rule of boundsRules(rubric)) {
    if (!rule.property.test(track.property)) continue;
    for (const key of track.keys) {
      if (typeof key.value !== "number") continue;
      if (key.value < rule.min || key.value > rule.max) {
        push(checks, emit(rubric, {
          id: "value-bounds",
          severity: "fail",
          message: `${rule.label} on ${evidence} (found ${key.value} at t=${key.t}).`,
          evidence
        }));
        break;
      }
    }
  }

  // Keys must live inside the clip timeline. Per-part stagger legitimately
  // extends trailing keys past the nominal duration (motion-grammar policy),
  // so allow a proportional tail before warning.
  const spanToleranceMs = Math.max(120, Math.round(clip.durationMs * 0.1));
  const overflow = track.keys.filter((key) => key.t > clip.durationMs + spanToleranceMs);
  if (overflow.length > 0) {
    push(checks, emit(rubric, {
      id: "track-span",
      severity: "warn",
      message: `${overflow.length} key(s) beyond clip.durationMs (${clip.durationMs}ms) on ${evidence}.`,
      evidence
    }));
  }

  // Loop seam continuity
  const first = track.keys[0];
  const last = track.keys[track.keys.length - 1];
  if (
    clip.loop &&
    track.keys.length >= 2 &&
    typeof first?.value === "number" &&
    typeof last?.value === "number" &&
    Math.abs(first.value - last.value) > 1e-6
  ) {
    push(checks, emit(rubric, {
      id: "loop-seam",
      severity: "warn",
      message: `Loop seam pop on ${evidence}: starts ${first.value}, ends ${last.value}.`,
      evidence
    }));
  }

  // Micro-jitter detection on position channels
  if (/^(translateX|translateY)$/.test(track.property)) {
    const numeric = track.keys.filter((key) => typeof key.value === "number");
    if (numeric.length >= 4) {
      let reversals = 0;
      let maxDelta = 0;
      for (let i = 2; i < numeric.length; i += 1) {
        const d1 = (numeric[i - 1]!.value as number) - (numeric[i - 2]!.value as number);
        const d2 = (numeric[i]!.value as number) - (numeric[i - 1]!.value as number);
        if (d1 * d2 < 0) reversals += 1;
        maxDelta = Math.max(maxDelta, Math.abs(d2));
      }
      if (reversals >= 3 && maxDelta < 2) {
        push(checks, emit(rubric, {
          id: "micro-jitter",
          severity: "warn",
          message: `Alternating sub-2px movement on ${evidence} reads as jitter.`,
          evidence
        }));
      }
    }
  }

  return checks;
}

function push(checks: CritiqueCheck[], check: CritiqueCheck | null): void {
  if (check) checks.push(check);
}

function amplitudeOf(track: SceneTrack): number {
  const values = track.keys.map((key) => key.value).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/** Structural critique across every artboard in a doc (weakest report wins). */
export function analyzeSceneMotion(doc: SceneDoc, rubric: MotionRubric = DEFAULT_RUBRIC): MotionCritique {
  const reports = doc.artboards.map((artboard) => analyzeArtboardMotion(artboard, rubric));
  if (reports.length === 0) {
    return scoreChecks([
      { id: "clip-exists", severity: "fail", message: "Scene has no artboards." }
    ], rubric);
  }
  const worst = reports.reduce((a, b) => (a.score <= b.score ? a : b));
  const merged: MotionCritique = {
    ...worst,
    checks: reports.flatMap((report) => report.checks),
    fixes: reports.flatMap((report) => report.fixes)
  };
  const fails = merged.checks.filter((check) => check.severity === "fail").length;
  return { ...merged, ok: fails === 0 };
}
