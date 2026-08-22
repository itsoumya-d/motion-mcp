import { claimedNameSubtrees, detectByGeometry, detectByName, hasBirdContext } from "./detector.js";
import { SCHEMA_BY_ID, SPECIES_SCHEMAS } from "./schemas.js";
import { parseSvg } from "./svg-parse.js";
import type {
  AnatomyManifest,
  AnatomyReport,
  AnimationQueue,
  Capability,
  DetectedPart,
  PartRole,
  QueueEventInput,
  QueuedEvent,
  ResolvedAction,
  ResolvedStep,
  RoleCount,
  SpeciesSchema,
  UnexpectedRole
} from "./types.js";

const DECORATIVE_ROLES = new Set<PartRole>(["shadow", "sparkle"]);
const NON_REMAPPABLE_ACTIONS = new Set(["caw"]);
const MATCH_THRESHOLD = 0.34;

interface SchemaScore {
  schema: SpeciesSchema;
  score: number;
  matched: RoleCount[];
  missing: RoleCount[];
  unexpected: UnexpectedRole[];
}

export function analyzeSvgAnatomy(svg: string): AnatomyReport {
  const notes: string[] = [];
  if (!svg || !/<svg\b/i.test(svg)) {
    return {
      ok: false,
      parts: [],
      manifest: emptyManifest(),
      alternativeSpecies: [],
      notes: ["No SVG source was available for anatomy analysis."]
    };
  }
  const { roots, canvas } = parseSvg(svg);
  const nameParts = detectByName(roots);
  const claimed = claimedNameSubtrees(roots);
  const birdContext = hasBirdContext(nameParts);
  const geometryParts = detectByGeometry(roots, canvas, claimed, birdContext);
  const parts = [...nameParts, ...geometryParts];

  if (geometryParts.length > 0) {
    notes.push(`${geometryParts.length} part${geometryParts.length === 1 ? "" : "s"} inferred geometrically from unnamed shapes.`);
  }

  const countBy = countByRole(parts);
  const scored = SPECIES_SCHEMAS.map((schema) => scoreSchema(schema, countBy));
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0] ?? fallbackScore();
  const alternatives = scored.slice(1).map((entry) => ({ speciesId: entry.schema.id, score: round3(entry.score) }));

  if (winner.schema.id === HUMAN_ID && (countBy.wing ?? 0) > 0) {
    notes.push("Hybrid anatomy: wings detected on a biped match — wave resolves to arms, flap stays available.");
  }
  if (winner.schema.id === CROW_ID && (countBy.arm ?? 0) > 0) {
    notes.push("Hybrid anatomy: arms detected on an avian match — wave resolves to wings per species action map.");
  }
  if ((countBy.eyes ?? 0) === 0 && parts.length >= 2) {
    notes.push("Looks like a character but no eye pair was detected — blink will not resolve until an eye group exists.");
  }
  if (winner.matched.length === 0) {
    notes.push("No recognizable anatomical roles were found.");
  }

  const manifest = buildManifest(winner);
  const capabilities = deriveCapabilities(countBy, winner.schema.id);
  return {
    ok: manifest.ok,
    parts,
    manifest: { ...manifest, capabilities },
    alternativeSpecies: alternatives,
    notes
  };
}

const HUMAN_ID = "human-biped";
const CROW_ID = "avian-crow";

function countByRole(parts: DetectedPart[]): Partial<Record<PartRole, number>> {
  const counts: Partial<Record<PartRole, number>> = {};
  for (const part of parts) {
    counts[part.role] = (counts[part.role] ?? 0) + 1;
  }
  return counts;
}

function scoreSchema(schema: SpeciesSchema, countBy: Partial<Record<PartRole, number>>): SchemaScore {
  const matched: RoleCount[] = [];
  const missing: RoleCount[] = [];
  const unexpected: UnexpectedRole[] = [];
  let achievedSum = 0;
  let total = 0;
  for (const [roleRaw, expectedRaw] of Object.entries(schema.expected) as Array<[PartRole, number]>) {
    const found = countBy[roleRaw] ?? 0;
    achievedSum += Math.min(found, expectedRaw) / expectedRaw;
    total += 1;
    if (found > 0) matched.push({ role: roleRaw, found, expected: expectedRaw });
    else missing.push({ role: roleRaw, found, expected: expectedRaw });
  }
  for (const [roleRaw, found] of Object.entries(countBy) as Array<[PartRole, number]>) {
    if (!(roleRaw in schema.expected) && !DECORATIVE_ROLES.has(roleRaw)) {
      unexpected.push({ role: roleRaw, found });
    }
  }
  const base = total > 0 ? achievedSum / total : 0;
  const penalty = Math.min(unexpected.length * 0.06, 0.24);
  return { schema, score: Math.max(base - penalty, 0), matched, missing, unexpected };
}

function fallbackScore(): SchemaScore {
  const schema = SCHEMA_BY_ID.get(HUMAN_ID)!;
  return { schema, score: 0, matched: [], missing: [], unexpected: [] };
}

function buildManifest(score: SchemaScore): Omit<AnatomyManifest, "capabilities"> {
  return {
    ok: score.score >= MATCH_THRESHOLD,
    speciesId: score.schema.id,
    speciesLabel: score.schema.label,
    matchConfidence: round3(score.score),
    matchedRoles: score.matched,
    unexpectedRoles: score.unexpected,
    missingRoles: score.missing,
    notes: []
  };
}

const CAPABILITY_DEFS: Array<{
  id: string;
  label: string;
  alternatives: Array<Array<{ role: PartRole; min: number }>>;
  speciesOnly?: string[];
}> = [
  { id: "blink", label: "Blink", alternatives: [[{ role: "eyes", min: 1 }]] },
  { id: "breathe", label: "Idle breathe", alternatives: [[{ role: "head", min: 1 }]] },
  { id: "nod", label: "Nod", alternatives: [[{ role: "head", min: 1 }]] },
  { id: "wave", label: "Wave or greeting lift", alternatives: [[{ role: "arm", min: 1 }], [{ role: "wing", min: 1 }]] },
  { id: "flap", label: "Wing flap", alternatives: [[{ role: "wing", min: 2 }]] },
  { id: "caw", label: "Beak caw", alternatives: [[{ role: "mouth", min: 1 }]], speciesOnly: ["avian-crow"] },
  { id: "tailFlick", label: "Tail flick", alternatives: [[{ role: "tail", min: 1 }]] },
  { id: "squat", label: "Squat rep", alternatives: [[{ role: "leg", min: 1 }]], speciesOnly: ["human-biped"] },
  { id: "hop", label: "Hop", alternatives: [[{ role: "leg", min: 1 }]] }
];

function deriveCapabilities(countBy: Partial<Record<PartRole, number>>, speciesId: string): Capability[] {
  const capabilities: Capability[] = [];
  for (const def of CAPABILITY_DEFS) {
    if (def.speciesOnly && !def.speciesOnly.includes(speciesId)) continue;
    for (const alternative of def.alternatives) {
      const satisfied = alternative.every((req) => (countBy[req.role] ?? 0) >= req.min);
      if (satisfied) {
        capabilities.push({
          id: def.id,
          label: def.label,
          roles: alternative.map((req) => req.role)
        });
        break;
      }
    }
  }
  return capabilities;
}

export function hasCapability(report: AnatomyReport, capabilityId: string): boolean {
  return report.manifest.capabilities.some((capability) => capability.id === capabilityId);
}

export function resolveAction(report: AnatomyReport, action: string): ResolvedAction {
  const speciesId = report.manifest.speciesId;
  const countBy = countByRole(report.parts);
  const ownSchema = SCHEMA_BY_ID.get(speciesId);
  let binding = ownSchema?.actions[action];
  let remappedFrom: string | undefined;
  if (!binding) {
    for (const schema of SPECIES_SCHEMAS) {
      if (schema.id === speciesId) continue;
      const candidate = schema.actions[action];
      if (!candidate || NON_REMAPPABLE_ACTIONS.has(action)) continue;
      const allRolesPresent = candidate.steps.every((step) => (countBy[step.role] ?? 0) > 0);
      if (allRolesPresent) {
        binding = candidate;
        remappedFrom = schema.id;
        break;
      }
    }
  }
  if (!binding) {
    const knownElsewhere = SPECIES_SCHEMAS.find((schema) => schema.actions[action]);
    const needed = knownElsewhere
      ? uniqueRoles(knownElsewhere.actions[action]!.steps.map((step) => step.role))
          .filter((role) => !(countBy[role] ?? 0))
          .join(", ")
      : "";
    return {
      ok: false,
      action,
      speciesId,
      steps: [],
      reason: `No "${action}" binding resolvable for ${speciesId}${needed ? ` — missing parts: ${needed}` : ""}.`
    };
  }
  const steps: ResolvedStep[] = [];
  for (const step of binding.steps) {
    const nodeIds = report.parts.filter((part) => part.role === step.role).map((part) => part.nodeId);
    if (nodeIds.length === 0) continue;
    steps.push({ ...step, nodeIds });
  }
  if (steps.length === 0) {
    return {
      ok: false,
      action,
      speciesId,
      remappedFrom,
      steps: [],
      reason: `Binding exists but no detected parts satisfy its roles (${uniqueRoles(binding.steps.map((step) => step.role)).join(", ")}).`
    };
  }
  return { ok: true, action, speciesId, remappedFrom, steps };
}

export function queueAnimation(report: AnatomyReport, timeline: QueueEventInput[]): AnimationQueue {
  const events: QueuedEvent[] = [];
  const unresolved: Array<{ action: string; atMs: number; reason: string }> = [];
  for (const input of timeline) {
    const resolved = resolveAction(report, input.action);
    if (resolved.ok) {
      events.push({ action: input.action, atMs: input.atMs, loop: input.loop ?? false, steps: resolved.steps });
    } else {
      unresolved.push({ action: input.action, atMs: input.atMs, reason: resolved.reason ?? "unresolvable" });
    }
  }
  return {
    ok: unresolved.length === 0,
    speciesId: report.manifest.speciesId,
    events,
    unresolved
  };
}

export function listSpecies(): Array<{ id: string; label: string }> {
  return SPECIES_SCHEMAS.map((schema) => ({ id: schema.id, label: schema.label }));
}

function uniqueRoles(roles: PartRole[]): PartRole[] {
  return [...new Set(roles)];
}

function emptyManifest(): AnatomyManifest {
  return {
    ok: false,
    speciesId: "unknown",
    speciesLabel: "Unknown",
    matchConfidence: 0,
    matchedRoles: [],
    unexpectedRoles: [],
    missingRoles: [],
    capabilities: [],
    notes: []
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
