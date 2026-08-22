import type { Vec3 } from "./types.js";

export interface RepCounterOptions {
  enterBelowDeg?: number;
  exitAboveDeg?: number;
  minPhaseMs?: number;
}

const DEFAULTS = { enterBelowDeg: 95, exitAboveDeg: 160, minPhaseMs: 250 };

export class RepCounter {
  count = 0;
  private phase: "above" | "below" = "above";
  private phaseStartedMs = Number.NaN;

  constructor(private readonly options: RepCounterOptions = {}) {}

  reset(): void {
    this.count = 0;
    this.phase = "above";
    this.phaseStartedMs = Number.NaN;
  }

  feed(angleDeg: number, nowMs: number): boolean {
    const enterBelow = this.options.enterBelowDeg ?? DEFAULTS.enterBelowDeg;
    const exitAbove = this.options.exitAboveDeg ?? DEFAULTS.exitAboveDeg;
    const minPhaseMs = this.options.minPhaseMs ?? DEFAULTS.minPhaseMs;

    if (this.phase === "above") {
      if (angleDeg <= enterBelow) {
        this.phase = "below";
        this.phaseStartedMs = nowMs;
      }
      return false;
    }
    if (angleDeg >= exitAbove && nowMs - this.phaseStartedMs >= minPhaseMs) {
      this.count += 1;
      this.phase = "above";
      this.phaseStartedMs = nowMs;
      return true;
    }
    return false;
  }
}

export function angleAtDeg(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = a[0] - b[0];
  const aby = a[1] - b[1];
  const abz = a[2] - b[2];
  const cbx = c[0] - b[0];
  const cby = c[1] - b[1];
  const cbz = c[2] - b[2];
  const dot = abx * cbx + aby * cby + abz * cbz;
  const magA = Math.hypot(abx, aby, abz);
  const magC = Math.hypot(cbx, cby, cbz);
  if (magA < 1e-9 || magC < 1e-9) return 180;
  const cos = Math.min(1, Math.max(-1, dot / (magA * magC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export class RepDepthTracker {
  private minDeg = Number.POSITIVE_INFINITY;
  private lastVerdict: boolean | null = null;

  constructor(private readonly shallowAboveDeg: number) {}

  sample(angleDeg: number): void {
    if (angleDeg < this.minDeg) this.minDeg = angleDeg;
  }

  close(): boolean {
    const shallow = Number.isFinite(this.minDeg) && this.minDeg > this.shallowAboveDeg;
    this.lastVerdict = shallow;
    this.minDeg = Number.POSITIVE_INFINITY;
    return shallow;
  }

  get wasShallow(): boolean | null {
    return this.lastVerdict;
  }
}
