/**
 * Lifecycle management for motion features from problem framing through production and maintenance.
 */

export type FeatureStage = "framing" | "specification" | "production" | "maintenance" | "deprecated";

export interface FeatureFraming {
  featureId: string;
  title: string;
  problemStatement: string;
  targetMetric: string;
  hasReducedMotionFallback: boolean;
}

export interface FeatureSpecification {
  durationMs: number;
  easing: string;
  targetPlatform: "flutter" | "react-native" | "web";
  maxFrameBudgetMs: number;
}

export interface ProductionHealthCheck {
  activeSessions: number;
  p99LatencyMs: number;
  errorRatePercent: number;
}

export interface MaintenanceAuditResult {
  featureId: string;
  status: "healthy" | "degraded" | "critical";
  message: string;
  actionRequired: boolean;
}

export interface FeatureRecord {
  framing: FeatureFraming;
  specification?: FeatureSpecification;
  stage: FeatureStage;
  history: Array<{ stage: FeatureStage; timestamp: number; note?: string }>;
}

export class FeatureLifecycleManager {
  private readonly records = new Map<string, FeatureRecord>();

  public frameFeature(input: FeatureFraming): FeatureRecord {
    if (!input.featureId || !input.featureId.trim()) {
      throw new Error("Validation error: featureId cannot be empty");
    }
    if (!input.title || !input.title.trim()) {
      throw new Error("Validation error: title cannot be empty");
    }
    if (!input.problemStatement || !input.problemStatement.trim()) {
      throw new Error("Validation error: problemStatement cannot be empty");
    }

    const record: FeatureRecord = {
      framing: { ...input },
      stage: "framing",
      history: [{ stage: "framing", timestamp: Date.now(), note: "Problem framed" }]
    };
    this.records.set(input.featureId, record);
    return record;
  }

  public specifyFeature(featureId: string, spec: FeatureSpecification): FeatureRecord {
    const record = this.records.get(featureId);
    if (!record) {
      throw new Error(`Feature '${featureId}' not found in lifecycle registry`);
    }
    if (spec.durationMs <= 0) {
      throw new Error("Validation error: durationMs must be positive");
    }
    if (spec.maxFrameBudgetMs <= 0) {
      throw new Error("Validation error: maxFrameBudgetMs must be positive");
    }

    record.specification = { ...spec };
    record.stage = "specification";
    record.history.push({ stage: "specification", timestamp: Date.now(), note: "Specification defined" });
    return record;
  }

  public promoteToProduction(featureId: string): FeatureRecord {
    const record = this.records.get(featureId);
    if (!record) {
      throw new Error(`Feature '${featureId}' not found in lifecycle registry`);
    }
    if (record.stage !== "specification" || !record.specification) {
      throw new Error(`Malformed transition: feature '${featureId}' must be in specification stage before production`);
    }

    record.stage = "production";
    record.history.push({ stage: "production", timestamp: Date.now(), note: "Promoted to production" });
    return record;
  }

  public auditMaintenance(featureId: string, health: ProductionHealthCheck): MaintenanceAuditResult {
    const record = this.records.get(featureId);
    if (!record) {
      throw new Error(`Feature '${featureId}' not found in lifecycle registry`);
    }
    if (health.errorRatePercent < 0 || health.errorRatePercent > 100) {
      throw new Error("Invalid errorRatePercent: must be between 0 and 100");
    }

    const maxBudget = record.specification?.maxFrameBudgetMs ?? 16.67;
    record.stage = "maintenance";
    record.history.push({ stage: "maintenance", timestamp: Date.now(), note: "Maintenance audit performed" });

    if (health.errorRatePercent > 5.0) {
      return {
        featureId,
        status: "critical",
        message: `High error rate (${health.errorRatePercent}% > 5.0%) detected`,
        actionRequired: true
      };
    }

    if (health.p99LatencyMs > maxBudget) {
      return {
        featureId,
        status: "degraded",
        message: `p99 latency (${health.p99LatencyMs}ms) exceeds frame budget (${maxBudget}ms)`,
        actionRequired: true
      };
    }

    return {
      featureId,
      status: "healthy",
      message: "Feature operational within SLA parameters",
      actionRequired: false
    };
  }

  public deprecateFeature(featureId: string, reason: string): FeatureRecord {
    const record = this.records.get(featureId);
    if (!record) {
      throw new Error(`Feature '${featureId}' not found in lifecycle registry`);
    }
    record.stage = "deprecated";
    record.history.push({ stage: "deprecated", timestamp: Date.now(), note: reason });
    return record;
  }

  public getRecord(featureId: string): FeatureRecord {
    const record = this.records.get(featureId);
    if (!record) {
      throw new Error(`Feature '${featureId}' not found in lifecycle registry`);
    }
    return record;
  }
}
