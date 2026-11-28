export interface ComponentContrastSpec {
  foreground: string;
  background: string;
  isLargeText?: boolean;
}

export interface ComponentTargetSizeSpec {
  width: number;
  height: number;
}

export interface ComponentMotionSpec {
  durationMs?: number;
  hasReducedMotionFallback?: boolean;
  frequencyHz?: number;
  loop?: boolean;
}

export interface ComponentSpec {
  id: string;
  role?: string;
  label?: string;
  contrast?: ComponentContrastSpec;
  targetSize?: ComponentTargetSizeSpec;
  motion?: ComponentMotionSpec;
}

export interface AccessibilityViolation {
  rule: string;
  severity: "fail" | "warn";
  message: string;
  fix: string;
}

export interface AccessibilityReport {
  ok: boolean;
  score: number;
  violations: AccessibilityViolation[];
  passes: string[];
  contrastRatio?: number;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let clean = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`invalid hex color string: "${hex}"`);
  }
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/**
 * Computes relative luminance and returns the WCAG 2.1 contrast ratio (between 1.0 and 21.0).
 * Reference: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
export function calculateContrastRatio(fgHex: string, bgHex: string): number {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const max = Math.max(l1, l2);
  const min = Math.min(l1, l2);
  const ratio = (max + 0.05) / (min + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * Audits a UI component specification against WCAG 2.2 AA accessibility and motion standards.
 */
export function auditComponentAccessibility(spec: ComponentSpec): AccessibilityReport {
  const violations: AccessibilityViolation[] = [];
  const passes: string[] = [];
  let contrastRatio: number | undefined;

  // 1. Interactive role & accessible name
  if (!spec.role || !spec.role.trim()) {
    violations.push({
      rule: "wcag-4.1.2-name-role-value",
      severity: "warn",
      message: `Component "${spec.id}" has no explicit ARIA role defined.`,
      fix: 'Assign a semantic HTML element or an explicit ARIA role (e.g. role="button", role="article").',
    });
  } else {
    passes.push("aria-role");
  }

  if (!spec.label || !spec.label.trim()) {
    violations.push({
      rule: "wcag-1.1.1-non-text-content",
      severity: "warn",
      message: `Component "${spec.id}" is missing an accessible label or name.`,
      fix: "Provide an accessible text label, aria-label, or title for assistive technologies.",
    });
  } else {
    passes.push("accessible-name");
  }

  // 2. Color Contrast (WCAG 1.4.3 Level AA)
  if (spec.contrast) {
    contrastRatio = calculateContrastRatio(spec.contrast.foreground, spec.contrast.background);
    const requiredMin = spec.contrast.isLargeText ? 3.0 : 4.5;
    if (contrastRatio < requiredMin) {
      violations.push({
        rule: "wcag-1.4.3-contrast-minimum",
        severity: "fail",
        message: `Contrast ratio of ${contrastRatio}:1 fails the required ${requiredMin}:1 minimum.`,
        fix: `Adjust foreground (${spec.contrast.foreground}) or background (${spec.contrast.background}) colors to exceed ${requiredMin}:1.`,
      });
    } else {
      passes.push("contrast");
    }
  }

  // 3. Target Size (WCAG 2.5.8 Level AA minimum 24x24px, recommended 44x44px)
  if (spec.targetSize) {
    if (spec.targetSize.width < 24 || spec.targetSize.height < 24) {
      violations.push({
        rule: "wcag-2.5.8-target-size-minimum",
        severity: "fail",
        message: `Interactive target dimension (${spec.targetSize.width}x${spec.targetSize.height}px) is below 24x24px.`,
        fix: "Increase touch/click target dimensions to at least 24x24 CSS pixels (recommended 44x44px).",
      });
    } else {
      passes.push("target-size");
    }
  }

  // 4. Motion & Flashing (WCAG 2.3.1 & 2.3.3)
  if (spec.motion) {
    if (spec.motion.frequencyHz && spec.motion.frequencyHz > 3) {
      violations.push({
        rule: "wcag-2.3.1-three-flashes",
        severity: "fail",
        message: `Animation frequency of ${spec.motion.frequencyHz} Hz exceeds the 3 Hz safety threshold.`,
        fix: "Reduce animation frequency to 3 Hz or lower to prevent seizure risks.",
      });
    } else if (spec.motion.frequencyHz !== undefined) {
      passes.push("flash-safety");
    }

    if (spec.motion.loop && spec.motion.hasReducedMotionFallback !== true) {
      violations.push({
        rule: "wcag-2.3.3-animation-from-interactions",
        severity: "fail",
        message: "Continuous looping motion requires a prefers-reduced-motion fallback.",
        fix: "Implement a reduced-motion variant or disable continuous looping under prefers-reduced-motion.",
      });
    } else if (spec.motion.hasReducedMotionFallback) {
      passes.push("reduced-motion");
    }
  }

  const fails = violations.filter((v) => v.severity === "fail").length;
  const warns = violations.filter((v) => v.severity === "warn").length;
  let score = 100 - fails * 25 - warns * 10;
  score = Math.max(0, Math.min(100, score));

  return {
    ok: fails === 0,
    score,
    violations,
    passes,
    contrastRatio,
  };
}
