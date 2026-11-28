import assert from "node:assert/strict";
import test from "node:test";
import { FeatureLifecycleManager } from "../packages/motion-planner/src/feature-lifecycle.ts";

test("test_feature_lifecycle_normal_progression", () => {
  const manager = new FeatureLifecycleManager();
  const framed = manager.frameFeature({
    featureId: "auth-sheet",
    title: "Authentication Modal",
    problemStatement: "Friction during modal dismissal",
    targetMetric: "Retention +3%",
    hasReducedMotionFallback: true
  });
  assert.equal(framed.stage, "framing");

  const specified = manager.specifyFeature("auth-sheet", {
    durationMs: 300,
    easing: "ease-out",
    targetPlatform: "flutter",
    maxFrameBudgetMs: 16.67
  });
  assert.equal(specified.stage, "specification");

  const prod = manager.promoteToProduction("auth-sheet");
  assert.equal(prod.stage, "production");

  const audit = manager.auditMaintenance("auth-sheet", {
    activeSessions: 500,
    p99LatencyMs: 14.0,
    errorRatePercent: 0.1
  });
  assert.equal(audit.status, "healthy");
  assert.equal(audit.actionRequired, false);
});

test("test_feature_lifecycle_empty_input_validation", () => {
  const manager = new FeatureLifecycleManager();
  assert.throws(
    () => manager.frameFeature({ featureId: "", title: "T", problemStatement: "P", targetMetric: "M", hasReducedMotionFallback: true }),
    /featureId cannot be empty/
  );
  assert.throws(
    () => manager.frameFeature({ featureId: "f1", title: "", problemStatement: "P", targetMetric: "M", hasReducedMotionFallback: true }),
    /title cannot be empty/
  );
  assert.throws(
    () => manager.frameFeature({ featureId: "f1", title: "T", problemStatement: "", targetMetric: "M", hasReducedMotionFallback: true }),
    /problemStatement cannot be empty/
  );
});

test("test_feature_lifecycle_invalid_malformed_transition", () => {
  const manager = new FeatureLifecycleManager();
  manager.frameFeature({
    featureId: "bad-transition",
    title: "Bad Transition",
    problemStatement: "Test invalid transitions",
    targetMetric: "N/A",
    hasReducedMotionFallback: false
  });

  // Cannot jump from framing directly to production without specification
  assert.throws(
    () => manager.promoteToProduction("bad-transition"),
    /Malformed transition/
  );

  // Negative duration
  assert.throws(
    () => manager.specifyFeature("bad-transition", { durationMs: -50, easing: "linear", targetPlatform: "web", maxFrameBudgetMs: 16.67 }),
    /durationMs must be positive/
  );
});

test("test_feature_lifecycle_boundary_budget_slo", () => {
  const manager = new FeatureLifecycleManager();
  manager.frameFeature({ featureId: "slo-bound", title: "SLO", problemStatement: "Boundary test", targetMetric: "SLO", hasReducedMotionFallback: true });
  manager.specifyFeature("slo-bound", { durationMs: 200, easing: "ease", targetPlatform: "react-native", maxFrameBudgetMs: 16.67 });
  manager.promoteToProduction("slo-bound");

  // At exactly 16.67ms -> healthy
  const boundaryAudit = manager.auditMaintenance("slo-bound", { activeSessions: 100, p99LatencyMs: 16.67, errorRatePercent: 0.0 });
  assert.equal(boundaryAudit.status, "healthy");

  // Above 16.67ms (e.g. 17.5ms) -> degraded
  const degradedAudit = manager.auditMaintenance("slo-bound", { activeSessions: 100, p99LatencyMs: 17.5, errorRatePercent: 0.0 });
  assert.equal(degradedAudit.status, "degraded");
  assert.equal(degradedAudit.actionRequired, true);
});

test("test_feature_lifecycle_dependency_telemetry_failure", () => {
  const manager = new FeatureLifecycleManager();
  // Unregistered feature lookup failure
  assert.throws(
    () => manager.getRecord("non-existent-feature"),
    /not found in lifecycle registry/
  );

  manager.frameFeature({ featureId: "telemetry-fail", title: "Failure Test", problemStatement: "Critical telemetry", targetMetric: "None", hasReducedMotionFallback: false });
  manager.specifyFeature("telemetry-fail", { durationMs: 100, easing: "linear", targetPlatform: "web", maxFrameBudgetMs: 16.67 });
  manager.promoteToProduction("telemetry-fail");

  // Critical error rate failure > 5.0%
  const critAudit = manager.auditMaintenance("telemetry-fail", { activeSessions: 100, p99LatencyMs: 10.0, errorRatePercent: 12.5 });
  assert.equal(critAudit.status, "critical");
  assert.equal(critAudit.actionRequired, true);
});

test("test_feature_lifecycle_property_monotonic_history", () => {
  const manager = new FeatureLifecycleManager();
  manager.frameFeature({ featureId: "hist-prop", title: "History", problemStatement: "Monotonic history", targetMetric: "M", hasReducedMotionFallback: true });
  manager.specifyFeature("hist-prop", { durationMs: 150, easing: "ease", targetPlatform: "flutter", maxFrameBudgetMs: 16.67 });
  manager.promoteToProduction("hist-prop");
  manager.auditMaintenance("hist-prop", { activeSessions: 50, p99LatencyMs: 8.0, errorRatePercent: 0.0 });
  manager.deprecateFeature("hist-prop", "Replaced by v2");

  const rec = manager.getRecord("hist-prop");
  assert.equal(rec.history.length, 5);
  for (let i = 1; i < rec.history.length; i++) {
    assert.ok(rec.history[i]!.timestamp >= rec.history[i - 1]!.timestamp);
  }
});
