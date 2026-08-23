import { flattenSvgNodes, nodeBBox, parseSvg } from "./svg-parse.js";
import type { BBox, DetectedPart, PartRole, SvgNode } from "./types.js";

const ROLE_NAME_PATTERNS: Array<{ role: PartRole; pattern: RegExp }> = [
  { role: "eyes", pattern: /(^|[^a-z])(eyes?|pupils?|iris|gaze|eyelids?|headlights?)([^a-z]|$)/i },
  { role: "wheel", pattern: /(^|[^a-z])(wheels?|tyres?|tires?)([^a-z]|$)/i },
  { role: "wing", pattern: /(^|[^a-z])(wings?|fins?)([^a-z]|$)/i },
  { role: "arm", pattern: /(^|[^a-z])(arms?|hands?|paws?)([^a-z]|$)/i },
  { role: "leg", pattern: /(^|[^a-z])(legs?|feet|foot|claws?|talons?)([^a-z]|$)/i },
  { role: "tail", pattern: /(^|[^a-z])(tails?|tuft)([^a-z]|$)/i },
  { role: "mouth", pattern: /(^|[^a-z])(mouths?|beaks?|bills?|smiles?|lips?)([^a-z]|$)/i },
  { role: "head", pattern: /(^|[^a-z])(heads?|face|cab)([^a-z]|$)/i },
  { role: "body", pattern: /(^|[^a-z])(torsos?|trunks?|bod(?:y|ies)|chest|belly|chassis|shell)([^a-z]|$)/i },
  { role: "shadow", pattern: /(shadow|shade)/i },
  { role: "sparkle", pattern: /(spark|star|shine|glow|flare|magic)/i }
];

export function labelOf(node: SvgNode): string {
  return `${node.id ?? ""} ${node.attrs["data-name"] ?? ""} ${node.className ?? ""}`.trim();
}

function matchRole(node: SvgNode): PartRole | null {
  const label = `${node.id ?? ""} ${node.attrs["data-name"] ?? ""} ${node.className ?? ""}`;
  if (!label.trim()) return null;
  for (const candidate of ROLE_NAME_PATTERNS) {
    if (candidate.pattern.test(label)) return candidate.role;
  }
  return null;
}

interface NameMatch {
  node: SvgNode;
  role: PartRole;
  depth: number;
}

function collectNameMatches(node: SvgNode, depth: number, ancestors: Array<{ role: PartRole }>, out: NameMatch[]): void {
  const role = matchRole(node);
  const nextAncestors = [...ancestors];
  if (role) {
    out.push({ node, role, depth });
    nextAncestors.push({ role });
  }
  for (const child of node.children) {
    collectNameMatches(child, depth + 1, nextAncestors, out);
  }
}

export function detectByName(roots: SvgNode[]): DetectedPart[] {
  const matches: NameMatch[] = [];
  for (const root of roots) collectNameMatches(root, 0, [], matches);
  const parts: DetectedPart[] = [];
  let pairCounter = 0;
  const pending = new Map<string, { match: NameMatch; pairId: number }>();
  for (const match of matches) {
    const hasSameRoleAncestor = matches.some(
      (other) => other.role === match.role && other.depth < match.depth && isAncestorOf(other.node, match.node)
    );
    if (hasSameRoleAncestor) continue;
    if (parts.some((part) => part.nodeId === match.node.nodeId)) continue;
    if (pending.has(match.node.nodeId)) continue;
    const sideKey = pairSideKey(match.role, match.node.nodeId);
    if (!sideKey) {
      parts.push(plainPart(match));
      continue;
    }
    const waiting = pending.get(`${match.role}:${sideKey.opposite}`);
    if (waiting !== undefined) {
      pending.delete(`${match.role}:${sideKey.opposite}`);
      parts.push({ ...plainPart(waiting.match), pairIndex: waiting.pairId });
      parts.push({ ...plainPart(match), pairIndex: waiting.pairId });
    } else {
      pairCounter += 1;
      pending.set(`${match.role}:${sideKey.side}`, { match, pairId: pairCounter });
    }
  }
  for (const entry of pending.values()) parts.push(plainPart(entry.match));
  return parts;
}

function plainPart(match: NameMatch): DetectedPart {
  return {
    role: match.role,
    nodeId: match.node.nodeId,
    label: labelOf(match.node) || match.role,
    source: "name",
    confidence: 0.98,
    bbox: nodeBBox(match.node) ?? undefined
  };
}

function isAncestorOf(candidate: SvgNode, target: SvgNode): boolean {
  return candidate.children.some((child) => child === target || isAncestorOf(child, target));
}

function pairSideKey(role: PartRole, nodeId: string): { side: "left" | "right"; opposite: "right" | "left" } | null {
  if (!["eyes", "arm", "wing", "leg", "wheel"].includes(role)) return null;
  const lower = nodeId.toLowerCase();
  if (/left|(^|[^a-z])l([-_ ]|$)/.test(lower)) return { side: "left", opposite: "right" };
  if (/right|(^|[^a-z])r([-_ ]|$)/.test(lower)) return { side: "right", opposite: "left" };
  return null;
}

interface GeometryCandidate {
  node: SvgNode;
  bbox: BBox;
  area: number;
}

export function detectByGeometry(
  roots: SvgNode[],
  canvas: { width: number; height: number },
  claimedSubtreeIds: Set<string>,
  birdContext: boolean
): DetectedPart[] {
  const svgRoot = roots.find((root) => root.tag === "svg") ?? roots[0];
  if (!svgRoot) return [];
  const candidates: GeometryCandidate[] = [];
  for (const child of svgRoot.children) {
    if (subtreeClaimsAny(claimedSubtreeIds, child)) continue;
    const bbox = nodeBBox(child);
    if (!bbox) continue;
    const area = bbox.width * bbox.height;
    if (area < 16) continue;
    candidates.push({ node: child, bbox, area });
  }
  const parts: DetectedPart[] = [];
  let pairCounter = 1000;
  const taken = new Set<number>();

  interface PairProposal {
    i: number;
    j: number;
    score: number;
    combinedArea: number;
  }

  const proposals: PairProposal[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const [leftBox, rightBox] = a.bbox.x <= b.bbox.x ? [a.bbox, b.bbox] : [b.bbox, a.bbox];
      const mirrorError = Math.abs(canvas.width - (leftBox.x + leftBox.width / 2) - (rightBox.x + rightBox.width / 2));
      if (mirrorError > canvas.width * 0.18) continue;
      const cyLeft = leftBox.y + leftBox.height / 2;
      const cyRight = rightBox.y + rightBox.height / 2;
      if (Math.abs(cyLeft - cyRight) > canvas.height * 0.16) continue;

      const areaRatio = Math.max(a.area, b.area) / Math.min(a.area, b.area);
      const heightRatio = Math.max(a.bbox.height, b.bbox.height) / Math.max(Math.min(a.bbox.height, b.bbox.height), 1e-6);
      const aspectA = a.bbox.width / Math.max(a.bbox.height, 1e-6);
      const aspectB = b.bbox.width / Math.max(b.bbox.height, 1e-6);
      const aspectDivergence = Math.max(aspectA, aspectB) / Math.max(Math.min(aspectA, aspectB), 1e-6);
      const score = 1 / (areaRatio * heightRatio * aspectDivergence);
      proposals.push({ i, j, score, combinedArea: a.area + b.area });
    }
  }
  proposals.sort(
    (p, q) => q.score - p.score || q.combinedArea - p.combinedArea || p.i - q.i || p.j - q.j
  );

  for (const proposal of proposals) {
    if (taken.has(proposal.i) || taken.has(proposal.j)) continue;
    const left = candidates[proposal.i]!;
    const right = candidates[proposal.j]!;
    const [leftBox, rightBox] = left.bbox.x <= right.bbox.x ? [left.bbox, right.bbox] : [right.bbox, left.bbox];
    const band = (leftBox.y + leftBox.height / 2 + rightBox.y + rightBox.height / 2) / 2 / canvas.height;
    const maxSideArea = Math.max(left.area, right.area) / (canvas.width * canvas.height);
    const wider =
      leftBox.width / Math.max(leftBox.height, 1e-6) >= rightBox.width / Math.max(rightBox.height, 1e-6)
        ? leftBox
        : rightBox;
    const aspect = wider.width / Math.max(wider.height, 1e-6);

    let role: PartRole;
    let confidence: number;
    if (band < 0.4 && maxSideArea < 0.06) {
      role = "eyes";
      confidence = Math.min(0.62 + proposal.score * 0.15, 0.75);
    } else if (band >= 0.55) {
      role = "leg";
      confidence = 0.5;
    } else if (aspect > 1.25 || birdContext) {
      role = "wing";
      confidence = birdContext ? 0.56 : 0.52;
    } else {
      role = "arm";
      confidence = 0.5;
    }

    pairCounter += 1;
    parts.push({
      role,
      nodeId: left.node.nodeId,
      label: `geometry:${role}-a`,
      source: "geometry",
      confidence,
      bbox: left.bbox,
      pairIndex: pairCounter
    });
    parts.push({
      role,
      nodeId: right.node.nodeId,
      label: `geometry:${role}-b`,
      source: "geometry",
      confidence,
      bbox: right.bbox,
      pairIndex: pairCounter
    });
    taken.add(proposal.i);
    taken.add(proposal.j);
  }

  const remaining = candidates.filter((_, index) => !taken.has(index)).sort((a, b) => b.area - a.area);
  let assignedHead = false;
  let assignedBody = false;
  for (const candidate of remaining) {
    const box = candidate.bbox;
    const cxRatio = (box.x + box.width / 2) / canvas.width;
    const cyRatio = (box.y + box.height / 2) / canvas.height;
    const relativeArea = candidate.area / (canvas.width * canvas.height);
    const elongation = box.height / Math.max(box.width, 1e-6);
    if (!assignedHead && cyRatio < 0.45 && cxRatio > 0.2 && cxRatio < 0.8 && relativeArea > 0.02) {
      parts.push({
        role: "head",
        nodeId: candidate.node.nodeId,
        label: "geometry:head",
        source: "geometry",
        confidence: 0.44,
        bbox: box
      });
      assignedHead = true;
      continue;
    }
    if (!assignedBody && relativeArea > 0.08 && cyRatio >= 0.35 && elongation < 1.4) {
      parts.push({
        role: "body",
        nodeId: candidate.node.nodeId,
        label: "geometry:body",
        source: "geometry",
        confidence: 0.42,
        bbox: box
      });
      assignedBody = true;
      continue;
    }
    if (elongation > 1.5 && cyRatio > 0.55) {
      parts.push({
        role: "tail",
        nodeId: candidate.node.nodeId,
        label: "geometry:tail",
        source: "geometry",
        confidence: 0.38,
        bbox: box
      });
    }
  }
  return parts;
}

function subtreeClaimsAny(claimed: Set<string>, node: SvgNode): boolean {
  if (claimed.has(node.nodeId)) return true;
  return node.children.some((child) => subtreeClaimsAny(claimed, child));
}

export function claimedNameSubtrees(roots: SvgNode[]): Set<string> {
  const claimed = new Set<string>();
  for (const root of roots) {
    for (const node of flattenSvgNodes(root)) {
      if (matchRole(node)) claimed.add(node.nodeId);
    }
  }
  return claimed;
}

export function hasBirdContext(parts: DetectedPart[]): boolean {
  return parts.some((part) => ["wing", "tail"].includes(part.role) && part.source === "name") ||
    parts.some((part) => part.role === "mouth");
}
