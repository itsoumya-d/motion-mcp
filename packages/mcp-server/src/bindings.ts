import { promises as fs } from "node:fs";
import path from "node:path";
import type { MotionBinding } from "@motion-mcp/shared-types";
import { nowIso } from "@motion-mcp/shared-types";
import type { SceneArtboard } from "@motion-mcp/scene-graph";
import { loadOptionalJson } from "./internals.js";

export interface StoredBindings {
  componentId: string;
  bindings: MotionBinding[];
  updatedAt: string;
}

/**
 * Deterministic mapping from app-state property semantics to MotionEvents.
 * This is the design⇄code contract: bound properties drive machine inputs,
 * exactly like Rive View Model inputs, but sourced from the user's app.
 */
const EVENT_RULES: Array<{ pattern: RegExp; event: string }> = [
  { pattern: /^(has|is)?errors?$|error$|^(is|has)?fail(ed|ure|s)?$/i, event: "error" },
  { pattern: /^(is)?(loading|pending|busy|submitting)$/i, event: "activate" },
  { pattern: /^(is)?success(ful)?$|^succeeded$|^complet(e|ed|ion)$|^done$|^reward(ed)?$/i, event: "success" }
];

/** Returns the MotionEvent a bound property drives, or undefined for pass-through props. */
export function eventForProperty(property: string): string | undefined {
  const normalized = property.replace(/[^a-z0-9]/gi, "");
  for (const rule of EVENT_RULES) {
    if (rule.pattern.test(normalized)) return rule.event;
  }
  return undefined;
}

function bindingsPath(root: string, componentId: string): string {
  return path.join(root, ".motion-mcp", "bindings", `${componentId}.json`);
}

export async function loadStoredBindings(
  root: string,
  componentId: string
): Promise<MotionBinding[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(bindingsPath(root, componentId), "utf8")) as StoredBindings;
    return parsed.bindings ?? [];
  } catch {
    return [];
  }
}

export async function upsertBinding(
  root: string,
  componentId: string,
  binding: MotionBinding
): Promise<StoredBindings> {
  const existing = await loadStoredBindings(root, componentId);
  const next = [
    ...existing.filter(
      (candidate) => !(candidate.property === binding.property && candidate.targetPart === binding.targetPart)
    ),
    binding
  ];
  const record: StoredBindings = {
    componentId,
    bindings: next,
    updatedAt: nowIso()
  };
  await fs.mkdir(path.dirname(bindingsPath(root, componentId)), { recursive: true });
  await fs.writeFile(bindingsPath(root, componentId), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

/**
 * Attaches persisted bindings onto a compiled SceneArtboard so emitters can
 * wire them into framework-native inputs. Returns the artboard for chaining.
 */
export async function attachStoredBindings<T extends SceneArtboard>(
  root: string,
  componentId: string,
  scene: T
): Promise<T> {
  const stored = await loadStoredBindings(root, componentId);
  if (stored.length > 0) {
    const known = new Set(scene.bindings.map((binding) => `${binding.property}->${binding.targetPart}`));
    const additions = stored.filter((binding) => !known.has(`${binding.property}->${binding.targetPart}`));
    scene.bindings = [...scene.bindings, ...additions];
  }
  return scene;
}

export interface BindingWiring {
  property: string;
  targetPart: string;
  event?: string;
  propType: "boolean" | "number" | "string";
}

/** Derives the typed prop surface + event wiring an emitter should generate. */
export function deriveBindingWiring(bindings: MotionBinding[]): BindingWiring[] {
  return bindings.map((binding) => ({
    property: binding.property,
    targetPart: binding.targetPart,
    event: eventForProperty(binding.property),
    propType: "boolean"
  }));
}
