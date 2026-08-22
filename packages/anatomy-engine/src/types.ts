export type PartRole =
  | "eyes"
  | "head"
  | "mouth"
  | "arm"
  | "wing"
  | "leg"
  | "tail"
  | "body"
  | "shadow"
  | "sparkle";

export type DetectionSource = "name" | "geometry";

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgNode {
  nodeId: string;
  tag: string;
  id?: string;
  className?: string;
  attrs: Record<string, string>;
  children: SvgNode[];
}

export interface DetectedPart {
  role: PartRole;
  nodeId: string;
  label: string;
  source: DetectionSource;
  confidence: number;
  bbox?: BBox;
  pairIndex?: number;
}

export type ControllerKind = "scaleY" | "rotate" | "translateY" | "translateX";

export interface ControllerStep {
  role: PartRole;
  controller: ControllerKind;
  amount: number;
  durationMs: number;
  holdMs?: number;
  easing?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring";
  note?: string;
}

export interface SpeciesAction {
  description: string;
  steps: ControllerStep[];
}

export interface ExpectedParts {
  head?: number;
  eyes?: number;
  mouth?: number;
  arm?: number;
  wing?: number;
  leg?: number;
  tail?: number;
  body?: number;
}

export interface SpeciesSchema {
  id: string;
  label: string;
  expected: ExpectedParts;
  actions: Record<string, SpeciesAction>;
}

export interface Capability {
  id: string;
  label: string;
  roles: PartRole[];
}

export interface RoleCount {
  role: PartRole;
  found: number;
  expected: number;
}

export interface UnexpectedRole {
  role: PartRole;
  found: number;
}

export interface AnatomyManifest {
  ok: boolean;
  speciesId: string;
  speciesLabel: string;
  matchConfidence: number;
  matchedRoles: RoleCount[];
  unexpectedRoles: UnexpectedRole[];
  missingRoles: RoleCount[];
  capabilities: Capability[];
  notes: string[];
}

export interface AnatomyReport {
  ok: boolean;
  parts: DetectedPart[];
  manifest: AnatomyManifest;
  alternativeSpecies: Array<{ speciesId: string; score: number }>;
  notes: string[];
}

export interface ResolvedStep extends ControllerStep {
  nodeIds: string[];
}

export interface ResolvedAction {
  ok: boolean;
  action: string;
  speciesId: string;
  remappedFrom?: string;
  steps: ResolvedStep[];
  reason?: string;
}

export interface QueueEventInput {
  action: string;
  atMs: number;
  loop?: boolean;
}

export interface QueuedEvent {
  action: string;
  atMs: number;
  loop: boolean;
  steps: ResolvedStep[];
}

export interface AnimationQueue {
  ok: boolean;
  speciesId: string;
  events: QueuedEvent[];
  unresolved: Array<{ action: string; atMs: number; reason: string }>;
}
