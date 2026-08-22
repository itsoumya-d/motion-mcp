import type { SceneDoc } from "@motion-mcp/scene-graph";
import { ScenePlayer } from "./player.js";
import { applyFrame } from "./svg-string.js";

export interface MotionSceneHost {
  attach(doc: SceneDoc, container: HTMLElement): void;
  detach(): void;
}

interface InternalState {
  player: ScenePlayer;
  sourceSvg: string | null;
  container: HTMLElement;
  raf: number | null;
  lastTs: number | null;
  reduced: boolean;
}

declare global {
  interface HTMLElementEventMap {
    "motion-state-change": CustomEvent<{ state: string }>;
  }
}

/**
 * Registers the `<motion-scene>` web component.
 *
 * Attributes:
 * - `src` — URL to a SceneDoc JSON document
 * - `state` — optional initial state override
 * - `reduced-motion` — force terminal frames (also honors prefers-reduced-motion)
 *
 * The artboard's `sourceSvg` (embedded via SceneDoc tooling) provides the
 * vector content; the player samples frames and patches transforms per rAF.
 */
export function registerMotionScene(tag = "motion-scene"): void {
  const registry = (globalThis as { customElements?: CustomElementRegistry }).customElements;
  if (!registry || registry.get(tag)) return;

  class MotionSceneElement extends HTMLElement {
    private internal: InternalState | null = null;

    static get observedAttributes(): string[] {
      return ["src", "state", "reduced-motion"];
    }

    connectedCallback(): void {
      void this.load();
    }

    disconnectedCallback(): void {
      this.stopLoop();
      this.internal = null;
    }

    attributeChangedCallback(name: string): void {
      if (name === "src" && this.isConnected) void this.load();
      if (name === "reduced-motion" && this.internal) {
        this.internal.reduced = this.prefersReduced();
        this.renderFrame(0);
      }
    }

    private prefersReduced(): boolean {
      if (this.hasAttribute("reduced-motion")) return true;
      return typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    }

    private async load(): Promise<void> {
      this.stopLoop();
      const src = this.getAttribute("src");
      let doc: SceneDoc | null = null;
      if (src) {
        try {
          doc = await (await fetch(src)).json() as SceneDoc;
        } catch {
          this.textContent = "motion-scene: failed to load " + src;
          return;
        }
      } else {
        const inline = this.querySelector('script[type="application/json"]');
        if (inline?.textContent) {
          try {
            doc = JSON.parse(inline.textContent) as SceneDoc;
          } catch {
            this.textContent = "motion-scene: invalid inline SceneDoc JSON";
            return;
          }
        }
      }
      if (!doc) return;

      const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      shadow.innerHTML = '<div part="stage" style="display:contents"></div>';
      const stage = shadow.querySelector("div")!;
      const sourceSvg = (doc.artboards[0] as { sourceSvg?: string } | undefined)?.sourceSvg ?? null;

      this.internal = {
        player: new ScenePlayer(doc, {
          artboardId: this.getAttribute("artboard") ?? undefined,
          reducedMotion: false
        }),
        sourceSvg,
        container: stage,
        raf: null,
        lastTs: null,
        reduced: this.prefersReduced()
      };

      const requested = this.getAttribute("state");
      if (requested) {
        try { this.internal.player.enterState(requested); } catch { /* keep initial */ }
      }

      this.bindPointerEvents();
      if (this.internal.reduced) {
        this.renderFrame(Number.POSITIVE_INFINITY);
      } else {
        this.startLoop();
      }
    }

    private bindPointerEvents(): void {
      const events: Array<[string, string]> = [
        ["pointerenter", "pointerEnter"],
        ["pointerleave", "pointerLeave"],
        ["pointerdown", "pressIn"],
        ["pointerup", "pressOut"],
        ["click", "activate"]
      ];
      for (const [dom, motion] of events) {
        this.addEventListener(dom, () => {
          if (!this.internal) return;
          if (this.internal.player.send(motion)) {
            this.dispatchEvent(new CustomEvent("motion-state-change", {
              detail: { state: this.internal.player.state },
              bubbles: true
            }));
            if (this.internal.reduced) this.renderFrame(Number.POSITIVE_INFINITY);
          }
        });
      }
    }

    private startLoop(): void {
      this.stopLoop();
      const tick = (ts: number) => {
        const state = this.internal;
        if (!state) return;
        const dt = state.lastTs === null ? 0 : ts - state.lastTs;
        state.lastTs = ts;
        this.renderFrame(dt);
        state.raf = requestAnimationFrame(tick);
      };
      this.internal!.raf = requestAnimationFrame(tick);
    }

    private stopLoop(): void {
      if (this.internal?.raf !== null && this.internal?.raf !== undefined) {
        cancelAnimationFrame(this.internal.raf);
      }
      if (this.internal) this.internal.lastTs = null;
    }

    private renderFrame(dtMs: number): void {
      const state = this.internal;
      if (!state) return;
      if (!state.sourceSvg) return;
      const frame = dtMs === Number.POSITIVE_INFINITY
        ? state.player.seek(Number.MAX_SAFE_INTEGER)
        : state.player.advance(dtMs);
      state.container.innerHTML = applyFrame(state.sourceSvg, frame);
    }
  }

  registry.define(tag, MotionSceneElement as unknown as CustomElementConstructor);
}
