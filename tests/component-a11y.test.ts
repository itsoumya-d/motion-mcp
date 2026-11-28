import assert from "node:assert/strict";
import test from "node:test";
import {
  auditComponentAccessibility,
  calculateContrastRatio,
  type ComponentSpec
} from "../packages/critic/src/index.ts";

test("Component Accessibility: 1. normal case: fully compliant component scores 100", () => {
  const spec: ComponentSpec = {
    id: "gallery-card",
    role: "article",
    label: "Historical Artifact Card",
    contrast: {
      foreground: "#111111",
      background: "#ffffff",
      isLargeText: false
    },
    targetSize: { width: 44, height: 44 },
    motion: {
      durationMs: 250,
      hasReducedMotionFallback: true,
      loop: false,
      frequencyHz: 0
    }
  };

  const report = auditComponentAccessibility(spec);
  assert.equal(report.ok, true);
  assert.equal(report.score, 100);
  assert.equal(report.violations.length, 0);
  assert.ok(report.passes.includes("contrast"));
  assert.ok(report.passes.includes("target-size"));
  assert.ok(report.passes.includes("aria-role"));
  assert.ok(report.passes.includes("accessible-name"));
  assert.ok(report.contrastRatio! >= 4.5);
});

test("Component Accessibility: 2. empty input: handles bare spec with warnings without throwing", () => {
  const emptySpec: ComponentSpec = {
    id: "unadorned-box"
  };

  const report = auditComponentAccessibility(emptySpec);
  assert.equal(report.ok, true); // only warnings, no blocking fails
  assert.ok(report.score < 100);
  assert.ok(report.violations.some((v) => v.rule.includes("name-role-value")));
  assert.ok(report.violations.some((v) => v.rule.includes("non-text-content")));
});

test("Component Accessibility: 3. malformed input: invalid hex colors throw clear error", () => {
  assert.throws(
    () => calculateContrastRatio("not-a-color", "#ffffff"),
    /invalid hex color string/
  );
  assert.throws(
    () => calculateContrastRatio("#12345z", "#ffffff"),
    /invalid hex color string/
  );
});

test("Component Accessibility: 4. boundary value: contrast boundary around 4.5:1 conforms to WCAG 1.4.3", () => {
  // #767676 on #ffffff is standard benchmark for ~4.54:1 contrast
  const ratioPassing = calculateContrastRatio("#767676", "#ffffff");
  assert.ok(ratioPassing >= 4.5, `Expected >= 4.5, got ${ratioPassing}`);

  const passingReport = auditComponentAccessibility({
    id: "text-element",
    role: "text",
    label: "Metadata summary",
    contrast: { foreground: "#767676", background: "#ffffff", isLargeText: false }
  });
  assert.ok(passingReport.passes.includes("contrast"));

  // #777777 on #ffffff yields ~4.47:1 which is below the 4.5:1 boundary
  const ratioFailing = calculateContrastRatio("#777777", "#ffffff");
  assert.ok(ratioFailing < 4.5, `Expected < 4.5, got ${ratioFailing}`);

  const failingReport = auditComponentAccessibility({
    id: "failing-text",
    role: "text",
    label: "Secondary text",
    contrast: { foreground: "#777777", background: "#ffffff", isLargeText: false }
  });
  assert.equal(failingReport.ok, false);
  assert.ok(failingReport.violations.some((v) => v.rule === "wcag-1.4.3-contrast-minimum"));
});

test("Component Accessibility: 5. dependency failure: undersized target dimensions fail WCAG 2.5.8", () => {
  const undersized: ComponentSpec = {
    id: "icon-button",
    role: "button",
    label: "Zoom Asset",
    targetSize: { width: 18, height: 18 } // Minimum is 24x24
  };

  const report = auditComponentAccessibility(undersized);
  assert.equal(report.ok, false);
  const violation = report.violations.find((v) => v.rule === "wcag-2.5.8-target-size-minimum");
  assert.ok(violation, "Expected target size violation");
  assert.equal(violation!.severity, "fail");
  assert.ok(violation!.fix.includes("24x24"));
});

test("Component Accessibility: 6. invariant property: contrast ratio is strictly between 1.0 and 21.0", () => {
  // Same color must be exactly 1.0
  const sameBlack = calculateContrastRatio("#000000", "#000000");
  assert.equal(sameBlack, 1.0);

  const sameWhite = calculateContrastRatio("#ffffff", "#ffffff");
  assert.equal(sameWhite, 1.0);

  // Black on white must be 21.0
  const maxContrast = calculateContrastRatio("#000000", "#ffffff");
  assert.equal(maxContrast, 21.0);

  // Arbitrary colors must satisfy 1.0 <= ratio <= 21.0
  const testColors = ["#336699", "#ffaa00", "#00ffcc", "#880088", "#123", "#abc"];
  for (const c1 of testColors) {
    for (const c2 of testColors) {
      const ratio = calculateContrastRatio(c1, c2);
      assert.ok(ratio >= 1.0 && ratio <= 21.0, `Ratio ${ratio} out of bounds for ${c1} / ${c2}`);
    }
  }
});

test("Component Accessibility: 7. motion safety: continuous loop without reduced-motion and high flashing fails", () => {
  const unsafeLoop: ComponentSpec = {
    id: "spinner",
    role: "progressbar",
    label: "Loading indicator",
    motion: {
      loop: true,
      hasReducedMotionFallback: false,
      frequencyHz: 5 // Flashing above 3 Hz
    }
  };

  const report = auditComponentAccessibility(unsafeLoop);
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((v) => v.rule === "wcag-2.3.1-three-flashes"));
  assert.ok(report.violations.some((v) => v.rule === "wcag-2.3.3-animation-from-interactions"));
});
