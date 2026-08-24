import { promises as fs } from "node:fs";
import path from "node:path";

export type RubricSeverity = "fail" | "warn";

export interface RubricCheckConfig {
  enabled: boolean;
  /** Severity applied when the check trips. Built-in default when omitted. */
  severity?: RubricSeverity;
}

export interface RubricBoundsRule {
  /** Regex source matched against track.property. */
  property: string;
  min: number;
  max: number;
  label: string;
}

export interface CurveLintConfig {
  /** Regex sources deciding which track properties are "primary motion". */
  primaryProperties: string[];
  /** Segments spanning at least this long with linear easing get flagged. */
  linearEasingMinSpanMs: number;
  easingMechanicalSeverity: RubricSeverity;
  /** Allowed magnitude jump factor between consecutive segment velocities. */
  velocityJumpRatio: number;
  velocityDiscontinuitySeverity: RubricSeverity;
}

export interface RenderRubricConfig {
  maxFrames: number;
  staticDiffEpsilon: number;
}

export interface JudgeRubricConfig {
  provider: "mock" | "gemini" | "claude";
  /** Minimum aliveness score (0-100) for the judge check to pass. */
  alivenessThreshold: number;
  weight: number;
}

export interface RepairRubricConfig {
  maxAttempts: number;
  /** Fix primitives the repair loop may apply automatically. */
  allowedFixes: string[];
}

/**
 * Editable scoring contract for the verification loop. Shipped defaults
 * replicate the critic's historical hardcoded behavior; projects override via
 * `.motion-mcp/rubric.json` (deep-merged over these defaults).
 */
export interface MotionRubric {
  version: 1;
  scoring: {
    failPenalty: number;
    warnPenalty: number;
    /** Minimum score for the repair loop to accept a result as passing. */
    passThreshold: number;
  };
  checks: Record<string, RubricCheckConfig>;
  bounds: RubricBoundsRule[];
  curveLint: CurveLintConfig;
  render: RenderRubricConfig;
  judge: JudgeRubricConfig;
  repair: RepairRubricConfig;
}

export const REPAIR_FIXES = ["sort-keys", "clamp-bounds", "loop-wrap", "rewrite-linear-easing"] as const;

export const DEFAULT_RUBRIC: MotionRubric = {
  version: 1,
  scoring: { failPenalty: 25, warnPenalty: 8, passThreshold: 100 },
  checks: {},
  bounds: [
    { property: "^opacity$", min: 0, max: 1, label: "opacity must stay within [0, 1]" },
    { property: "^(scale|scaleX|scaleY)$", min: 0.05, max: 5, label: "scale should stay within [0.05, 5]" },
    { property: "^rotate$", min: -1080, max: 1080, label: "rotation beyond ±1080° is almost always a bug" },
    { property: "^(translateX|translateY|x|y)$", min: -20000, max: 20000, label: "translation far outside any artboard" }
  ],
  curveLint: {
    primaryProperties: ["^(scale|scaleX|scaleY)$", "^(translateX|translateY)$", "^rotate$"],
    linearEasingMinSpanMs: 120,
    easingMechanicalSeverity: "warn",
    velocityJumpRatio: 6,
    velocityDiscontinuitySeverity: "warn"
  },
  render: { maxFrames: 6, staticDiffEpsilon: 0.05 },
  judge: { provider: "mock", alivenessThreshold: 55, weight: 1 },
  repair: { maxAttempts: 3, allowedFixes: [...REPAIR_FIXES] }
};

export const RUBRIC_CHECK_IDS = [
  "clip-exists",
  "keys-sorted",
  "value-bounds",
  "loop-seam",
  "duration-sane",
  "track-span",
  "micro-jitter",
  "reduced-motion",
  "render-static",
  "render-blank",
  "easing-mechanical",
  "velocity-discontinuity",
  "judge-aliveness"
] as const;

export type RubricCheckId = (typeof RUBRIC_CHECK_IDS)[number];

/** Resolves one check's config; unknown ids default to enabled. */
export function checkConfig(
  rubric: MotionRubric,
  id: string
): { enabled: boolean; severity?: RubricSeverity } {
  const config = rubric.checks[id];
  if (!config) return { enabled: true };
  return { enabled: config.enabled ?? true, severity: config.severity };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeRubric(base: MotionRubric, override: unknown): MotionRubric {
  if (!isPlainObject(override)) return base;
  const merged: Record<string, unknown> = { ...base } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = mergeSection(current, value);
    } else {
      merged[key] = value;
    }
  }
  return merged as unknown as MotionRubric;
}

function mergeSection(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = mergeSection(current, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Loads the effective rubric: shipped defaults deep-merged with the project's
 * `.motion-mcp/rubric.json` when present. Explicit paths win over discovery.
 */
export async function loadRubric(projectRoot?: string, explicitPath?: string): Promise<MotionRubric> {
  const candidatePaths: string[] = [];
  if (explicitPath) candidatePaths.push(path.resolve(explicitPath));
  if (projectRoot) candidatePaths.push(path.join(projectRoot, ".motion-mcp", "rubric.json"));
  for (const candidate of candidatePaths) {
    let raw: string;
    try {
      raw = await fs.readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1) {
      throw new Error(`Rubric ${candidate} must declare "version": 1.`);
    }
    return mergeRubric(DEFAULT_RUBRIC, parsed);
  }
  return DEFAULT_RUBRIC;
}
