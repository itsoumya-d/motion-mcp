import type { SceneArtboard, SceneClip, SceneDoc, SceneTrack } from "@motion-mcp/scene-graph";

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

const FAIL_PENALTY = 25;
const WARN_PENALTY = 8;

export function scoreChecks(checks: CritiqueCheck[]): MotionCritique {
  let score = 100;
  const fixes: string[] = [];
  for (const check of checks) {
    if (check.severity === "fail") {
      score -= FAIL_PENALTY;
      fixes.push(fixFor(check));
    } else if (check.severity === "warn") {
      score -= WARN_PENALTY;
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
  "render-blank": () => "Frames render blank — verify sourceSvg is attached to the artboard and fills are not fully transparent."
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

const BOUNDS_RULES: BoundsRule[] = [
  { property: /^opacity$/, min: 0, max: 1, label: "opacity must stay within [0, 1]" },
  { property: /^(scale|scaleX|scaleY)$/, min: 0.05, max: 5, label: "scale should stay within [0.05, 5]" },
  { property: /^rotate$/, min: -1080, max: 1080, label: "rotation beyond ±1080° is almost always a bug" },
  { property: /^(translateX|translateY|x|y)$/, min: -20000, max: 20000, label: "translation far outside any artboard" }
];

/**
 * Deterministic structural review of one artboard's clips.
 * Pure math over SceneDoc — no rasterization, safe to run anywhere.
 */
export function analyzeArtboardMotion(artboard: SceneArtboard): MotionCritique {
  const checks: CritiqueCheck[] = [];
  const clipIds = Object.keys(artboard.clips);

  if (clipIds.length === 0) {
    checks.push({
      id: "clip-exists",
      severity: "fail",
      message: "Artboard has no compiled clips."
    });
    return scoreChecks(checks);
  }

  for (const clipId of clipIds) {
    const clip = artboard.clips[clipId]!;
    checks.push(...critiqueClip(clip));
  }

  if (artboard.semantics?.reducedMotionSafe !== true) {
    const hasLargeAmplitude = clipIds.some((clipId) =>
      artboard.clips[clipId]!.tracks.some((track) => amplitudeOf(track) > LARGE_AMPLITUDE)
    );
    if (hasLargeAmplitude) {
      checks.push({
        id: "reduced-motion",
        severity: "warn",
        message: "Large-amplitude loops exist without semantics.reducedMotionSafe."
      });
    } else {
      checks.push({
        id: "reduced-motion",
        severity: "pass",
        message: "Reduced-motion exposure is low."
      });
    }
  }

  return scoreChecks(checks);
}

const LARGE_AMPLITUDE = 20;

function critiqueClip(clip: SceneClip): CritiqueCheck[] {
  const checks: CritiqueCheck[] = [];

  if (!(clip.durationMs > 0 && clip.durationMs <= 60000)) {
    checks.push({
      id: "duration-sane",
      severity: "fail",
      message: `Clip "${clip.name}" has an invalid durationMs (${clip.durationMs}).`
    });
  }

  if (clip.tracks.length === 0) {
    checks.push({
      id: "clip-exists",
      severity: "fail",
      message: `Clip "${clip.name}" has no tracks.`,
      evidence: clip.clipId
    });
    return checks;
  }

  for (const track of clip.tracks) {
    const evidence = `${clip.name}:${track.targetPart}.${track.property}`;
    checks.push(...critiqueTrack(track, clip, evidence));
  }

  return checks;
}

function critiqueTrack(track: SceneTrack, clip: SceneClip, evidence: string): CritiqueCheck[] {
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
    checks.push({ id: "keys-sorted", severity: "fail", message: `Keys are not time-sorted on ${evidence}.`, evidence });
  }
  if (duplicate && !unsorted) {
    checks.push({ id: "keys-sorted", severity: "warn", message: `Duplicate key times on ${evidence}; later key wins when sampled.`, evidence });
  }

  // Value bounds
  for (const rule of BOUNDS_RULES) {
    if (!rule.property.test(track.property)) continue;
    for (const key of track.keys) {
      if (typeof key.value !== "number") continue;
      if (key.value < rule.min || key.value > rule.max) {
        checks.push({
          id: "value-bounds",
          severity: "fail",
          message: `${rule.label} on ${evidence} (found ${key.value} at t=${key.t}).`,
          evidence
        });
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
    checks.push({
      id: "track-span",
      severity: "warn",
      message: `${overflow.length} key(s) beyond clip.durationMs (${clip.durationMs}ms) on ${evidence}.`,
      evidence
    });
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
    checks.push({
      id: "loop-seam",
      severity: "warn",
      message: `Loop seam pop on ${evidence}: starts ${first.value}, ends ${last.value}.`,
      evidence
    });
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
        checks.push({
          id: "micro-jitter",
          severity: "warn",
          message: `Alternating sub-2px movement on ${evidence} reads as jitter.`,
          evidence
        });
      }
    }
  }

  return checks;
}

function amplitudeOf(track: SceneTrack): number {
  const values = track.keys.map((key) => key.value).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/** Structural critique across every artboard in a doc (weakest report wins). */
export function analyzeSceneMotion(doc: SceneDoc): MotionCritique {
  const reports = doc.artboards.map(analyzeArtboardMotion);
  if (reports.length === 0) {
    return scoreChecks([
      { id: "clip-exists", severity: "fail", message: "Scene has no artboards." }
    ]);
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
