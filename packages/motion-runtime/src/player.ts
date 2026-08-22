import { sampleClip } from "./clip.js";
import type { MotionClip, PoseSample, Vec3 } from "./types.js";

interface Layer {
  clip: MotionClip;
  startedAtMs: number;
  weight: number;
  ratePerMs: number;
  target: 0 | 1;
  ended: boolean;
  kind: "base" | "overlay";
}

export interface PlayOptions {
  fadeMs?: number;
  restartIfActive?: boolean;
}

export class MotionPlayer {
  private clips = new Map<string, MotionClip>();
  private layers: Layer[] = [];
  private clockMs = 0;
  private endedFired = new Set<Layer>();
  speed = 1;
  paused = false;
  onClipEnd: ((clipId: string) => void) | null = null;

  registerClips(clips: MotionClip[]): void {
    for (const clip of clips) this.clips.set(clip.id, clip);
  }

  hasClip(clipId: string): boolean {
    return this.clips.has(clipId);
  }

  get registeredClipIds(): string[] {
    return [...this.clips.keys()];
  }

  play(clipId: string, options: PlayOptions = {}): boolean {
    return this.startLayer(clipId, options, "base");
  }

  playOverlay(clipId: string, options: PlayOptions = {}): boolean {
    return this.startLayer(clipId, options, "overlay");
  }

  private startLayer(clipId: string, options: PlayOptions, kind: "base" | "overlay"): boolean {
    const clip = this.clips.get(clipId);
    if (!clip) return false;
    const activeSame = this.layers.find(
      (layer) => layer.kind === kind && layer.clip.id === clipId && layer.target === 1 && !layer.ended
    );
    if (activeSame && !(options.restartIfActive ?? false)) return false;
    const fadeMs = Math.max(options.fadeMs ?? 260, 1);
    if (kind === "base") {
      for (const layer of this.layers) {
        if (layer.kind === "base") layer.target = 0;
      }
    }
    this.layers.push({
      clip,
      startedAtMs: this.clockMs,
      weight: 0,
      ratePerMs: 1 / fadeMs,
      target: 1,
      ended: false,
      kind
    });
    return true;
  }

  stop(fadeMs = 180): void {
    for (const layer of this.layers) {
      layer.target = 0;
      layer.ratePerMs = Math.max(layer.ratePerMs, 1 / Math.max(fadeMs, 1));
    }
  }

  topLayer(): Layer | null {
    let best: Layer | null = null;
    for (const layer of this.layers) {
      if (best === null || layer.weight >= best.weight) best = layer;
    }
    return best;
  }

  currentClipId(): string | null {
    return this.topLayer()?.clip.id ?? null;
  }

  currentBaseClipId(): string | null {
    let best: Layer | null = null;
    for (const layer of this.layers) {
      if (layer.kind !== "base") continue;
      if (best === null || layer.weight > best.weight) best = layer;
    }
    return best?.clip.id ?? null;
  }

  update(deltaMs: number): PoseSample | null {
    if (!this.paused && deltaMs !== 0) {
      const dt = deltaMs * this.speed;
      this.clockMs += dt;
      for (const layer of this.layers) {
        if (!layer.ended && layer.clip.loop === false) {
          const elapsed = this.clockMs - layer.startedAtMs;
          if (elapsed >= layer.clip.durationMs) {
            layer.ended = true;
            layer.target = 0;
            if (!this.endedFired.has(layer)) {
              this.endedFired.add(layer);
              this.onClipEnd?.(layer.clip.id);
            }
          }
        }
        const direction = layer.target === 1 ? 1 : -1;
        layer.weight = Math.min(1, Math.max(0, layer.weight + direction * layer.ratePerMs * dt));
      }
      this.layers = this.layers.filter((layer) => !(layer.target === 0 && layer.weight === 0));
    }

    const active = this.layers.filter((layer) => layer.weight > 0);
    if (active.length === 0) return null;
    let totalWeight = 0;
    for (const layer of active) totalWeight += layer.weight;
    if (totalWeight <= 0) return null;

    const samples = active.map((layer) => ({
      layer,
      pose: sampleClip(layer.clip, this.clockMs - layer.startedAtMs)
    }));

    const rotations: Record<string, Vec3> = {};
    const translations: Record<string, Vec3> = {};
    const accum = (store: Record<string, Vec3>, source: Record<string, Vec3>, w: number) => {
      for (const [joint, vec] of Object.entries(source)) {
        const entry = store[joint] ?? (store[joint] = [0, 0, 0]);
        entry[0] += vec[0] * w;
        entry[1] += vec[1] * w;
        entry[2] += vec[2] * w;
      }
    };
    for (const { layer, pose } of samples) {
      const w = layer.weight / totalWeight;
      accum(rotations, pose.rotations, w);
      accum(translations, pose.translations, w);
    }
    const top = this.topLayer();
    return {
      timeMs: this.clockMs,
      clipId: top?.clip.id ?? samples[0]!.pose.clipId,
      rotations,
      translations
    };
  }
}
