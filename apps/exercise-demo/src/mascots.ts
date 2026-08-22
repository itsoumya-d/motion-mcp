import {
  CROW_SVG,
  HUMAN_SVG,
  analyzeSvgAnatomy,
  resolveAction
} from "@motion-mcp/anatomy-engine";
import type { AnatomyReport, ResolvedStep } from "@motion-mcp/anatomy-engine";

const EASING: Record<string, string> = {
  linear: "linear",
  easeIn: "cubic-bezier(.55,0,.85,.45)",
  easeOut: "cubic-bezier(.15,.65,.35,1)",
  easeInOut: "cubic-bezier(.45,0,.55,1)",
  spring: "cubic-bezier(.34,1.56,.64,1)"
};

function originFor(role: string): string {
  switch (role) {
    case "arm":
    case "wing":
    case "leg":
      return "50% 4%";
    case "head":
      return "50% 88%";
    case "tail":
      return "88% 12%";
    default:
      return "50% 50%";
  }
}

function identityFor(controller: string): string {
  if (controller === "rotate") return "rotate(0deg)";
  if (controller === "translateY") return "translateY(0px)";
  if (controller === "translateX") return "translateX(0px)";
  return "scaleY(1)";
}

function transformFor(controller: string, amount: number): string {
  if (controller === "rotate") return `rotate(${amount}deg)`;
  if (controller === "translateY") return `translateY(${amount}px)`;
  if (controller === "translateX") return `translateX(${amount}px)`;
  return `scaleY(${amount})`;
}

export class Mascot {
  readonly label: string;
  private readonly report: AnatomyReport;
  private readonly rootEl: HTMLElement;

  constructor(container: HTMLElement, svg: string, label: string) {
    this.label = label;
    this.report = analyzeSvgAnatomy(svg);
    const figure = document.createElement("figure");
    figure.className = "mascot";
    const caption = document.createElement("figcaption");
    caption.textContent = `${label} · ${this.report.manifest.speciesLabel}`;
    const art = document.createElement("div");
    art.className = "art";
    art.innerHTML = svg;
    figure.append(caption, art);
    container.append(figure);
    this.rootEl = figure;

    for (const part of this.report.parts) {
      const el = this.elementFor(part.nodeId);
      if (!el) continue;
      el.style.transformBox = "fill-box";
      el.style.transformOrigin = originFor(part.role);
    }  }

  can(actionId: string): boolean {
    return this.report.manifest.capabilities.some((capability) => capability.id === actionId);
  }

  play(actionId: string): boolean {
    const resolved = resolveAction(this.report, actionId);
    if (!resolved.ok) return false;
    const current = new Map<string, string>();
    let delayMs = 0;
    for (const step of resolved.steps) {
      for (const nodeId of step.nodeIds) {
        const el = this.elementFor(nodeId);
        if (!el) continue;
        const key = `${step.controller}:${nodeId}`;
        const from = current.get(key) ?? identityFor(step.controller);
        const to = transformFor(step.controller, step.amount);
        current.set(key, to);
        el.animate(
          [{ transform: from }, { transform: to }],
          {
            duration: step.durationMs,
            delay: delayMs,
            easing: EASING[step.easing ?? "easeInOut"] ?? "ease-in-out",
            fill: "none"
          }
        );
      }
      delayMs += step.durationMs + (step.holdMs ?? 0);
    }
    return true;
  }

  private elementFor(nodeId: string): HTMLElement | SVGElement | null {
    return this.rootEl.querySelector(`#${CSS.escape(nodeId)}`) as HTMLElement | SVGElement | null;
  }
}

export function reactToRep(mascot: Mascot, repNumber: number): void {
  const milestone = repNumber % 5 === 0;
  if (mascot.can("flap")) mascot.play(milestone ? "caw" : "flap");
  else if (mascot.can("wave")) mascot.play(milestone ? "wave" : "nod");
  else mascot.play("blink");
}

export function reactToFormWarning(mascot: Mascot): void {
  if (mascot.can("caw")) mascot.play("caw");
  else if (mascot.can("nod")) mascot.play("nod");
  else mascot.play("blink");
}

export function reactToWorkoutDone(mascot: Mascot): void {
  if (mascot.can("flap")) mascot.play("flap");
  else if (mascot.can("wave")) mascot.play("wave");
  else mascot.play("breathe");
}

export function buildMascots(container: HTMLElement): { human: Mascot; crow: Mascot } {
  container.innerHTML = "";
  return {
    human: new Mascot(container, HUMAN_SVG, "Coach"),
    crow: new Mascot(container, CROW_SVG, "Corvus")
  };
}
