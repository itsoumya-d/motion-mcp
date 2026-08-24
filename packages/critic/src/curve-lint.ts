import type { SceneDoc, SceneKeyframe, SceneTrack } from "@motion-mcp/scene-graph";
import type { MotionCritique } from "./checks.js";
import { scoreChecks, type CritiqueCheck } from "./checks.js";
import { checkConfig, DEFAULT_RUBRIC, type MotionRubric, type RubricSeverity } from "./rubric.js";

const VELOCITY_EPSILON = 1e-9;

interface CompiledLinters {
  primaryProperties: RegExp[];
}

function compileLinters(rubric: MotionRubric): CompiledLinters {
  return {
    primaryProperties: rubric.curveLint.primaryProperties.map((source) => new RegExp(source))
  };
}

/**
 * Motion-curve linting over pure SceneDoc math — no rasterization.
 *
 * - easing-mechanical: long segments approaching keys with linear easing read
 *   as robotic; natural motion eases in/out.
 * - velocity-discontinuity: a segment whose velocity magnitude explodes
 *   relative to its predecessor pops on screen (missing frames, wrong units,
 *   or a stray key).
 *
 * Intentional decaying shakes never trip the velocity rule because their
 * magnitudes only fall.
 */
export function lintCurves(doc: SceneDoc, rubric: MotionRubric = DEFAULT_RUBRIC): MotionCritique {
  const linters = compileLinters(rubric);
  const checks: CritiqueCheck[] = [];
  for (const artboard of doc.artboards) {
    for (const clip of Object.values(artboard.clips)) {
      for (const track of clip.tracks) {
        const evidence = `${clip.name}:${track.targetPart}.${track.property}`;
        if (isPrimary(track, linters)) {
          checks.push(...lintMechanicalEasing(track, evidence, rubric));
        }
        checks.push(...lintVelocityDiscontinuity(track, evidence, rubric));
      }
    }
  }
  return scoreChecks(checks, rubric);
}

function isPrimary(track: SceneTrack, linters: CompiledLinters): boolean {
  return linters.primaryProperties.some((pattern) => pattern.test(track.property));
}

function lintMechanicalEasing(
  track: SceneTrack,
  evidence: string,
  rubric: MotionRubric
): CritiqueCheck[] {
  const config = checkConfig(rubric, "easing-mechanical");
  if (!config.enabled) return [];
  const severity: RubricSeverity = config.severity ?? rubric.curveLint.easingMechanicalSeverity;
  const minSpan = rubric.curveLint.linearEasingMinSpanMs;
  const checks: CritiqueCheck[] = [];
  for (let index = 1; index < track.keys.length; index += 1) {
    const arriving = track.keys[index]!;
    if (arriving.easing !== "linear") continue;
    const span = segmentSpanMs(track.keys, index);
    if (span < minSpan) continue;
    checks.push({
      id: "easing-mechanical",
      severity,
      message: `Linear easing across a ${Math.round(span)}ms segment reads as mechanical on ${evidence} (approaching t=${arriving.t}).`,
      evidence
    });
  }
  return checks;
}

function lintVelocityDiscontinuity(
  track: SceneTrack,
  evidence: string,
  rubric: MotionRubric
): CritiqueCheck[] {
  const config = checkConfig(rubric, "velocity-discontinuity");
  if (!config.enabled) return [];
  const severity: RubricSeverity = config.severity ?? rubric.curveLint.velocityDiscontinuitySeverity;
  const ratioLimit = rubric.curveLint.velocityJumpRatio;
  const numeric = track.keys.filter(
    (key): key is SceneKeyframe & { value: number } => typeof key.value === "number"
  );
  if (numeric.length < 3) return [];
  const checks: CritiqueCheck[] = [];
  let previousVelocity = segmentVelocity(numeric, 1);
  for (let index = 2; index < numeric.length; index += 1) {
    const velocity = segmentVelocity(numeric, index);
    if (
      previousVelocity !== null &&
      velocity !== null &&
      Math.abs(previousVelocity) > VELOCITY_EPSILON &&
      Math.abs(velocity) > ratioLimit * Math.abs(previousVelocity)
    ) {
      const key = numeric[index]!;
      checks.push({
        id: "velocity-discontinuity",
        severity,
        message: `Velocity jumps ${round(velocity / previousVelocity)}× between adjacent segments before t=${key.t} on ${evidence}; motion will pop.`,
        evidence
      });
    }
    previousVelocity = velocity ?? previousVelocity;
  }
  return checks;
}

function segmentVelocity(keys: Array<SceneKeyframe & { value: number }>, index: number): number | null {
  const a = keys[index - 1];
  const b = keys[index];
  if (!a || !b) return null;
  const span = b.t - a.t;
  if (span <= 0) return null;
  return (b.value - a.value) / span;
}

function segmentSpanMs(keys: Array<{ t: number }>, index: number): number {
  return Math.abs(keys[index]!.t - keys[index - 1]!.t);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
