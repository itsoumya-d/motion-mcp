import { decodePng } from "@motion-mcp/capture";
import { analyzeSvgAnatomy, buildCharacterRig } from "@motion-mcp/anatomy-engine";
import type { SceneRig } from "@motion-mcp/scene-graph";
import { colorToHex, quantizeFrame, simplifyLoop, traceColorMask } from "@motion-mcp/vectorizer";

export interface PerceiveImageOptions {
  /** Palette size for median-cut quantization. Default 6. */
  maxColors?: number;
  /** Maximum number of semantic parts emitted. Default 12. */
  maxParts?: number;
  /** RDP simplification epsilon in pixels. Default 1.5. */
  epsilon?: number;
  /** Drop traced regions whose pixel area is below this. Default 24. */
  minAreaPx?: number;
}

export interface PerceivedPart {
  partId: string;
  colorHex: string;
  areaPx: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  pathCount: number;
  centroid: { x: number; y: number };
}

export interface PerceivedImage {
  width: number;
  height: number;
  svg: string;
  parts: PerceivedPart[];
  paletteSize: number;
}

/**
 * Image-to-parts perception: a raster PNG becomes a layered SVG whose
 * connected color regions are separate, named, reviewable parts — the input
 * the auto-rigger and state-machine compilers expect. Deterministic:
 * identical bytes produce identical SVG.
 *
 * This is segmentation by paint region, not pose estimation — role labels
 * come downstream from anatomy analysis (see proposeRigFromImage).
 */
export function perceiveImage(png: Uint8Array, options: PerceiveImageOptions = {}): PerceivedImage {
  const maxColors = clamp(options.maxColors ?? 6, 2, 16);
  const maxParts = clamp(options.maxParts ?? 12, 1, 64);
  const epsilon = options.epsilon ?? 1.5;
  const minArea = options.minAreaPx ?? 24;

  const decoded = decodePng(png);
  const { rgba, width, height } = decoded;
  const quantized = quantizeFrame(rgba, width, height, maxColors);

  interface PartCandidate {
    colorIndex: number;
    d: string;
    area: number;
    bbox: PerceivedPart["bbox"];
    centroid: { x: number; y: number };
    pointCount: number;
  }

  const candidates: PartCandidate[] = [];
  for (let colorIndex = 0; colorIndex < quantized.palette.length; colorIndex += 1) {
    const mask = new Uint8Array(width * height);
    let paintedPixels = 0;
    for (let pixel = 0; pixel < quantized.indices.length; pixel += 1) {
      if (quantized.indices[pixel] === colorIndex) {
        mask[pixel] = 1;
        paintedPixels += 1;
      }
    }
    if (paintedPixels < minArea) continue;

    for (const loop of traceColorMask(mask, width, height)) {
      const area = Math.abs(shoelaceArea(loop));
      if (area < minArea) continue;
      const simplified = simplifyLoop(loop, epsilon);
      candidates.push({
        colorIndex,
        d: loopToPath(simplified),
        area,
        bbox: bboxOf(simplified),
        centroid: centroidOf(loop),
        pointCount: simplified.length
      });
    }
  }

  candidates.sort((a, b) => b.area - a.area);
  const kept = candidates.slice(0, maxParts);

  const parts: PerceivedPart[] = kept.map((candidate, index) => ({
    partId: `part-${index + 1}`,
    colorHex: colorToHex(quantized.palette[candidate.colorIndex]!),
    areaPx: Math.round(candidate.area),
    bbox: candidate.bbox,
    centroid: roundPoint(candidate.centroid),
    pathCount: 1
  }));

  const groups = kept
    .map((candidate, index) =>
      `  <g id="part-${index + 1}">\n    <path d="${candidate.d}" fill="${colorToHex(
        quantized.palette[candidate.colorIndex]!
      )}"/>\n  </g>`
    )
    .join("\n");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n` +
    `${groups}\n</svg>`;

  return { width, height, svg, parts, paletteSize: quantized.palette.length };
}

export interface RigProposalFromImage {
  proposalOnly: true;
  svg: string;
  width: number;
  height: number;
  parts: PerceivedPart[];
  speciesId: string;
  matchConfidence: number;
  capabilities: string[];
  suggestedStates: string[];
  rigBlock: SceneRig;
  notes: string[];
  nextTool: "rig_asset" | "generate_animation";
}

/**
 * Full image → rig-proposal seam: perceive parts into an SVG, then run the
 * same anatomy detection and auto-rigger used for authored SVGs. Nothing is
 * persisted; the caller reviews species/bones before committing via
 * `rig_asset`.
 */
export function proposeRigFromImage(png: Uint8Array, options: PerceiveImageOptions = {}): RigProposalFromImage {
  const perceived = perceiveImage(png, options);
  const anatomy = analyzeSvgAnatomy(perceived.svg);
  const rigged = buildCharacterRig(perceived.svg);
  return {
    proposalOnly: true,
    svg: perceived.svg,
    width: perceived.width,
    height: perceived.height,
    parts: perceived.parts,
    speciesId: rigged.rig.speciesId ?? anatomy.manifest.speciesId ?? "blob",
    matchConfidence: rigged.rig.matchConfidence ?? anatomy.manifest.matchConfidence ?? 0,
    capabilities: anatomy.manifest.capabilities.map((capability) => capability.id),
    suggestedStates: rigged.suggestedStates,
    rigBlock: rigged.rig,
    notes: [
      ...anatomy.notes,
      "Parts are paint-region segments; verify the proposed bone mapping covers the parts you consider limbs/head."
    ],
    nextTool: "rig_asset"
  };
}

function shoelaceArea(points: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function loopToPath(points: Array<{ x: number; y: number }>): string {
  const round = (value: number) =>
    Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  const body = points.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)},${round(point.y)}`);
  return `${body.join("")}Z`;
}

function bboxOf(points: Array<{ x: number; y: number }>): PerceivedPart["bbox"] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function centroidOf(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  return { x: sumX / points.length, y: sumY / points.length };
}

function roundPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
