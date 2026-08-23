import type {
  SceneBone,
  SceneIkChain,
  SceneRig,
  SceneSecondaryMotion
} from "@motion-mcp/scene-graph";
import { analyzeSvgAnatomy } from "./anatomy.js";
import { parseSvg } from "./svg-parse.js";
import type { AnatomyReport, BBox, DetectedPart, PartRole } from "./types.js";

/** Roles that become bones, in parent-before-child construction order. */
const BONE_ORDER: PartRole[] = [
  "body",
  "head",
  "eyes",
  "arm",
  "wing",
  "leg",
  "tail",
  "wheel"
];

const LIMB_ROLES: Set<PartRole> = new Set(["arm", "wing", "leg", "wheel"]);
const DECORATIVE_ROLES: Set<PartRole> = new Set(["shadow", "sparkle"]);

export interface CharacterRigResult {
  report: AnatomyReport;
  rig: SceneRig;
  /** Grammar-aligned state names this rig can drive. */
  suggestedStates: string[];
}

/**
 * Auto-rigs any SVG into a SceneDoc character rig:
 * bones from detected anatomy, a look-at IK chain over the eyes, and
 * ambient secondary motion so every asset ships alive by default.
 * Universal guarantee: even an SVG with zero recognizable parts gets a
 * root bone plus breathe secondary motion.
 */
export function buildCharacterRig(svg: string): CharacterRigResult {
  const report = analyzeSvgAnatomy(svg);
  const canvas = parseSvg(svg).canvas;

  const riggable = report.parts.filter((part) => !DECORATIVE_ROLES.has(part.role));
  const ordered = orderParts(riggable);
  const rootPart =
    ordered.find((part) => part.role === "body") ??
    ordered.find((part) => part.role === "head") ??
    ordered[0];

  const bones: SceneBone[] = [];
  const usedNodeIds = new Set<string>();
  const ordinals = new Map<string, number>();

  const nextOrdinal = (roleKey: string): number => {
    const value = (ordinals.get(roleKey) ?? 0) + 1;
    ordinals.set(roleKey, value);
    return value;
  };

  const makeBoneId = (roleKey: string): string => `bone_${roleKey}_${nextOrdinal(roleKey)}`;

  const originFor = (part: DetectedPart | undefined): { x: number; y: number } => {
    const box: BBox | undefined = part?.bbox;
    if (!box) return { x: round1(canvas.width / 2), y: round1(canvas.height / 2) };
    return { x: round1(box.x + box.width / 2), y: round1(box.y + box.height / 2) };
  };

  const addBone = (
    roleKey: string,
    name: string,
    part: DetectedPart | undefined,
    parentBoneId?: string
  ): string => {
    const boneId = makeBoneId(roleKey);
    const length = part && LIMB_ROLES.has(part.role) && part.bbox
      ? round1(Math.max(part.bbox.width, part.bbox.height) / 2)
      : undefined;
    bones.push({
      boneId,
      name,
      ...(parentBoneId ? { parentBoneId } : {}),
      targetParts: part ? [part.nodeId] : ["*"],
      origin: originFor(part),
      ...(length !== undefined ? { length } : {})
    });
    if (part) usedNodeIds.add(part.nodeId);
    return boneId;
  };

  // Root bone: body, else head, else first riggable part.
  const rootBoneId = rootPart
    ? addBone("root", "root", rootPart)
    : addBone("root", "root", undefined);

  // Head bones attach to root; remaining body parts attach to root too.
  const headBoneId = ensureRoleBones("head", "head", rootBoneId);

  // Limb-family bones attach to root; eyes attach to the head bone when present.
  for (const role of BONE_ORDER) {
    if (role === "body" || role === "head") continue;
    const parent = role === "eyes" ? headBoneId ?? rootBoneId : rootBoneId;
    ensureRoleBones(role, role, parent);
  }

  function ensureRoleBones(
    role: PartRole,
    roleKey: string,
    parentBoneId: string
  ): string | undefined {
    let firstBoneId: string | undefined;
    const candidates = ordered.filter(
      (candidate) => candidate.role === role && !usedNodeIds.has(candidate.nodeId)
    );
    candidates.forEach((part, index) => {
      const boneId = addBone(roleKey, index === 0 ? role : `${role}-${index + 1}`, part, parentBoneId);
      firstBoneId = firstBoneId ?? boneId;
    });
    return firstBoneId;
  }

  const ikChains: SceneIkChain[] = [];
  const eyeBones = bones.filter((bone) => bone.name === "eyes" || bone.name.startsWith("eyes-"));
  if (eyeBones.length > 0) {
    ikChains.push({
      chainId: "chain_look_at",
      name: "eye look-at",
      boneIds: eyeBones.map((bone) => bone.boneId),
      targetPart: eyeBones[0]!.targetParts[0] ?? "*",
      hint: "look-at"
    });
  }

  return {
    report,
    rig: {
      speciesId: report.ok ? report.manifest.speciesId : "blob",
      matchConfidence: report.manifest.matchConfidence,
      bones,
      ikChains,
      secondaryMotion: buildSecondaryMotion(report)
    },
    suggestedStates: suggestStates(report)
  };
}

function buildSecondaryMotion(report: AnatomyReport): SceneSecondaryMotion[] {
  const motion: SceneSecondaryMotion[] = [];
  const byRole = (role: PartRole): DetectedPart[] =>
    report.parts.filter((part) => part.role === role);

  const breatheTargets = byRole("body").length > 0 ? byRole("body") : byRole("head");
  const breatheTarget = breatheTargets[0]?.nodeId
    ?? byRole("eyes")[0]?.nodeId
    ?? report.parts[0]?.nodeId
    ?? "*";
  motion.push({ partId: breatheTarget, kind: "breathe", amount: 1.5, periodMs: 3400 });

  for (const part of byRole("eyes")) {
    motion.push({ partId: part.nodeId, kind: "blink", amount: 0.88, periodMs: 4200, phaseMs: 0 });
  }

  const tail = byRole("tail")[0];
  if (tail) {
    motion.push({ partId: tail.nodeId, kind: "spring", amount: 6, periodMs: 2600, phaseMs: 400 });
  }

  byRole("wing").forEach((part, index) => {
    motion.push({
      partId: part.nodeId,
      kind: "sway",
      amount: 4,
      periodMs: 3000,
      phaseMs: index * 140
    });
  });

  return motion;
}

function orderParts(parts: DetectedPart[]): DetectedPart[] {
  const byRole = new Map<PartRole, DetectedPart[]>();
  for (const part of parts) {
    const bucket = byRole.get(part.role) ?? [];
    bucket.push(part);
    byRole.set(part.role, bucket);
  }
  const ordered: DetectedPart[] = [];
  for (const role of BONE_ORDER) {
    const bucket = byRole.get(role) ?? [];
    bucket.sort(
      (a, b) =>
        b.confidence - a.confidence ||
        (a.pairIndex ?? Number.MAX_SAFE_INTEGER) - (b.pairIndex ?? Number.MAX_SAFE_INTEGER) ||
        a.nodeId.localeCompare(b.nodeId)
    );
    ordered.push(...bucket);
  }
  return ordered;
}

function suggestStates(report: AnatomyReport): string[] {
  const states = new Set<string>(["idle-breathe", "hover-lift", "press-squish"]);
  const capabilityIds = new Set(report.manifest.capabilities.map((capability) => capability.id));
  if (capabilityIds.has("blink")) states.add("idle-blink");
  if (capabilityIds.has("wave")) states.add("hover-greet");
  if (capabilityIds.has("flap") || capabilityIds.has("buzz")) states.add("active-flap");
  if (capabilityIds.has("roll") || capabilityIds.has("trot")) states.add("active-move");
  if (capabilityIds.has("caw")) states.add("success-caw");
  if (report.parts.some((part) => part.role === "sparkle")) states.add("success-pop");
  if (capabilityIds.has("wobble")) states.add("error-wobble");
  return Array.from(states);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
