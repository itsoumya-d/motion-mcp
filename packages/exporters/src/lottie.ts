import type {
  SceneArtboard,
  SceneClip,
  SceneDoc,
  SceneKeyframe,
  SceneTrack
} from "@motion-mcp/scene-graph";
import {
  flattenSvgNodes,
  parseSvgDocument,
  type Matrix
} from "@motion-mcp/svg-parser";
import type { SvgNodeInfo } from "@motion-mcp/shared-types";
import { pathToBezier } from "./path-bezier.js";
import { artboardSource, pickArtboard, pickClip } from "./animated-svg.js";

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [
    m[0]! * x + m[2]! * y + m[4]!,
    m[1]! * x + m[3]! * y + m[5]!
  ];
}

export interface LottieOptions {
  artboardId?: string;
  /** Which state's clip drives the animation. Defaults to the initial state. */
  state?: string;
  fps?: number;
}

const SHAPE_TAGS = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const DEFAULT_SIZE = 512;

/**
 * Converts a SceneDoc artboard (+ embedded sourceSvg) into Lottie JSON.
 *
 * One Lottie shape layer per top-level SVG child; descendant shapes compose
 * through their parsed transforms. Transform/opacity tracks map to Lottie
 * transform properties; easings become bezier handles, holds use h:1, and
 * SVG arcs arrive pre-converted to cubics.
 */
export function toLottie(doc: SceneDoc, options: LottieOptions = {}): Record<string, unknown> {
  const artboard = pickArtboard(doc, options.artboardId);
  const source = artboardSource(artboard);
  const parsed = parseSvgDocument(source);
  const root = parsed.roots[0];
  if (!root) throw new Error("artboard sourceSvg has no parseable root");

  const clip = pickClip(artboard, options.state);
  const fps = options.fps ?? 60;
  const durationMs = Math.max(clip.durationMs, 1);
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const dims = parsed.dimensions ?? {};
  const size = viewBoxSize(dims.viewBox);
  const width = dims.width ?? size.width ?? DEFAULT_SIZE;
  const height = dims.height ?? size.height ?? DEFAULT_SIZE;

  // Bodymovin lists topmost layer first — reverse so SVG paint order holds.
  const layers: Record<string, unknown>[] = [];
  for (let index = root.children.length - 1; index >= 0; index -= 1) {
    const layer = buildLayer(root.children[index]!, clip, {
      uid: index + 1,
      totalFrames,
      durationMs
    });
    if (layer) layers.push(layer);
  }

  return {
    v: "5.7.4",
    fr: fps,
    ip: 0,
    op: totalFrames,
    w: Math.round(width),
    h: Math.round(height),
    nm: artboard.name || artboard.artboardId,
    ddd: 0,
    assets: [],
    layers,
    markers: []
  };
}

interface LayerContext {
  uid: number;
  totalFrames: number;
  durationMs: number;
}

function buildLayer(
  node: SvgNodeInfo,
  clip: SceneClip,
  ctx: LayerContext
): Record<string, unknown> | null {
  const flat = flattenSvgNodes(node);
  const drawables = flat.filter((candidate) => SHAPE_TAGS.has(candidate.tag));
  if (drawables.length === 0 && !SHAPE_TAGS.has(node.tag)) return null;

  const shapes: Record<string, unknown>[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let fillSource: SvgNodeInfo | undefined;

  for (const drawable of drawables) {
    if (!fillSource) fillSource = drawable;
    const item = shapeItemFor(drawable, matrixOf(drawable));
    if (!item) continue;
    shapes.push(...item.shapes);
    minX = Math.min(minX, item.bounds.minX);
    minY = Math.min(minY, item.bounds.minY);
    maxX = Math.max(maxX, item.bounds.maxX);
    maxY = Math.max(maxY, item.bounds.maxY);
  }
  if (shapes.length === 0 || !Number.isFinite(minX)) return null;

  const centerX = round4((minX + maxX) / 2);
  const centerY = round4((minY + maxY) / 2);

  const tracks = clip.tracks.filter(
    (track) => track.targetPart === "*" || matchPart(track.targetPart, node)
  );
  const baseOpacity = Number.parseFloat(node.attrs.opacity ?? "1") * 100;

  return {
    ddd: 0,
    ind: ctx.uid,
    ty: 4,
    nm: labelFor(node, ctx.uid),
    sr: 1,
    ks: {
      o: opacityProperty(tracks, baseOpacity, ctx),
      r: rotationProperty(tracks, ctx),
      p: pointProperty(tracks, centerX, centerY, ctx),
      a: { a: 0, k: [centerX, centerY] },
      s: scaleProperty(tracks, ctx)
    },
    ao: 0,
    shapes: [...shapes, fillItem(fillSource ?? node)],
    ip: 0,
    op: ctx.totalFrames,
    st: 0,
    bm: 0
  };
}

// ---------------------------------------------------------------------------
// Animated transform properties
// ---------------------------------------------------------------------------

type KeyMap = (value: number | string | number[]) => number[];

/**
 * Builds one Lottie property from SceneDoc keyframes.
 * Easing lives on the ARRIVING key (same convention as scene-graph).
 */
function buildAnimated(
  keys: SceneKeyframe[],
  map: KeyMap,
  staticValue: number[],
  ctx: LayerContext
): Record<string, unknown> {
  if (keys.length === 0) return { a: 0, k: staticValue };
  if (keys.length === 1) return { a: 0, k: map(keys[0]!.value) };
  const frameAt = (t: number) => Math.max(0, Math.round((t / ctx.durationMs) * ctx.totalFrames));
  const keyframes: Record<string, unknown>[] = [];
  for (let index = 0; index < keys.length - 1; index += 1) {
    const start = keys[index]!;
    const arriving = keys[index + 1]!;
    const segment: Record<string, unknown> = {
      t: frameAt(start.t),
      s: map(start.value),
      e: map(arriving.value)
    };
    switch (arriving.easing) {
      case "hold":
        segment.h = 1;
        break;
      case "easeIn":
        segment.o = { x: 0.42, y: 0 };
        segment.i = { x: 1, y: 1 };
        break;
      case "easeOut":
      case "spring":
        segment.o = { x: 0, y: 0 };
        segment.i = { x: 0.58, y: 1 };
        break;
      case "easeInOut":
        segment.o = { x: 0.42, y: 0 };
        segment.i = { x: 0.58, y: 1 };
        break;
      default:
        break; // linear — omit tangents
    }
    keyframes.push(segment);
  }
  keyframes.push({
    t: Math.min(frameAt(keys[keys.length - 1]!.t), ctx.totalFrames),
    s: map(keys[keys.length - 1]!.value)
  });
  return { a: 1, k: keyframes };
}

function tracksFor(tracks: SceneTrack[], property: string): SceneKeyframe[] {
  return tracks.find((track) => track.property === property)?.keys ?? [];
}

function sampleTrack(tracks: SceneTrack[], property: string, t: number): number {
  const keys = tracksFor(tracks, property);
  if (keys.length === 0) return 0;
  if (t <= keys[0]!.t) return asNum(keys[0]!.value);
  if (t >= keys[keys.length - 1]!.t) return asNum(keys[keys.length - 1]!.value);
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const k0 = keys[lo]!;
  const k1 = keys[hi]!;
  const u = (t - k0.t) / Math.max(k1.t - k0.t, 1e-6);
  return asNum(k0.value) + (asNum(k1.value) - asNum(k0.value)) * u;
}

function pointProperty(
  tracks: SceneTrack[],
  cx: number,
  cy: number,
  ctx: LayerContext
): Record<string, unknown> {
  const txKeys = tracksFor(tracks, "translateX");
  const tyKeys = tracksFor(tracks, "translateY");
  if (txKeys.length === 0 && tyKeys.length === 0) {
    return { a: 0, k: [cx, cy] };
  }
  const times = [...new Set([...txKeys, ...tyKeys].map((key) => key.t))].sort((a, b) => a - b);
  const synthetic: SceneKeyframe[] = times.map((t) => ({
    t,
    value: [sampleTrack(tracks, "translateX", t), sampleTrack(tracks, "translateY", t)] as number[],
    easing: undefined
  }));
  return buildAnimated(synthetic, (value) => {
    const pair = Array.isArray(value) ? value : [asNum(value), 0];
    return [round4(cx + (pair[0] ?? 0)), round4(cy + (pair[1] ?? 0))];
  }, [cx, cy], ctx);
}

function scaleProperty(tracks: SceneTrack[], ctx: LayerContext): Record<string, unknown> {
  return buildAnimated(tracksFor(tracks, "scale"), (value) => {
    const scalar = asNum(value) * 100;
    return [round4(scalar), round4(scalar), 100];
  }, [100, 100, 100], ctx);
}

function rotationProperty(tracks: SceneTrack[], ctx: LayerContext): Record<string, unknown> {
  const keys = tracksFor(tracks, "rotate");
  if (keys.length === 0) return { a: 0, k: 0 };
  const prop = buildAnimated(keys, (value) => [round4(asNum(value))], [0], ctx);
  if (prop.a === 0) return { a: 0, k: (prop.k as number[])[0] ?? 0 };
  return prop;
}

function opacityProperty(
  tracks: SceneTrack[],
  basePercent: number,
  ctx: LayerContext
): Record<string, unknown> {
  const keys = tracksFor(tracks, "opacity");
  if (keys.length === 0) return { a: 0, k: round4(basePercent) };
  const prop = buildAnimated(
    keys,
    (value) => [round4(asNum(value) * basePercent)],
    [basePercent],
    ctx
  );
  if (prop.a === 0) return { a: 0, k: (prop.k as number[])[0] ?? basePercent };
  return prop;
}

// ---------------------------------------------------------------------------
// Shape conversion
// ---------------------------------------------------------------------------

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function shapeItemFor(drawable: SvgNodeInfo, m: Matrix): { shapes: Record<string, unknown>[]; bounds: Bounds } | null {
  const a = drawable.attrs;
  switch (drawable.tag) {
    case "circle": {
      const r = num(a.r);
      if (r === undefined) return null;
      const [px, py] = apply(m, num(a.cx) ?? 0, num(a.cy) ?? 0);
      const sxLen = columnScaleX(m);
      const syLen = columnScaleY(m);
      return {
        shapes: [{ d: 1, ty: "el", s: { a: 0, k: [round4(r * 2 * sxLen), round4(r * 2 * syLen)] }, p: { a: 0, k: [round4(px), round4(py)] }, nm: "Ellipse" }],
        bounds: boundsOfCenter(px, py, r * sxLen, r * syLen)
      };
    }
    case "ellipse": {
      const rx = num(a.rx);
      const ry = num(a.ry);
      if (rx === undefined || ry === undefined) return null;
      const [px, py] = apply(m, num(a.cx) ?? 0, num(a.cy) ?? 0);
      const sxLen = columnScaleX(m);
      const syLen = columnScaleY(m);
      return {
        shapes: [{ d: 1, ty: "el", s: { a: 0, k: [round4(rx * 2 * sxLen), round4(ry * 2 * syLen)] }, p: { a: 0, k: [round4(px), round4(py)] }, nm: "Ellipse" }],
        bounds: boundsOfCenter(px, py, rx * sxLen, ry * syLen)
      };
    }
    case "rect": {
      const w = num(a.width);
      const h = num(a.height);
      if (w === undefined || h === undefined) return null;
      const x = num(a.x) ?? 0;
      const y = num(a.y) ?? 0;
      const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => apply(m, px!, py!));
      const xs = corners.map(([px]) => px);
      const ys = corners.map(([, py]) => py);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return {
        shapes: [{
          d: 1,
          ty: "rc",
          s: { a: 0, k: [round4(Math.max(...xs) - Math.min(...xs)), round4(Math.max(...ys) - Math.min(...ys))] },
          p: { a: 0, k: [round4(cx), round4(cy)] },
          r: { a: 0, k: round4(num(a.rx) ?? 0) },
          nm: "Rect"
        }],
        bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
      };
    }
    case "line":
    case "polyline":
    case "polygon": {
      const pointsText = a.points ?? `${a.x1 ?? 0},${a.y1 ?? 0} ${a.x2 ?? 0},${a.y2 ?? 0}`;
      const nums = pointsText.split(/[\s,]+/).map(Number).filter((value) => Number.isFinite(value));
      const pts: number[][] = [];
      for (let index = 0; index + 1 < nums.length; index += 2) {
        pts.push(apply(m, nums[index]!, nums[index + 1]!));
      }
      if (pts.length < 2) return null;
      return verticesToShape(pts, drawable.tag === "polygon");
    }
    case "path": {
      const subpaths = pathToBezier(a.d ?? "");
      if (subpaths.length === 0) return null;
      const outShapes: Record<string, unknown>[] = [];
      let bMinX = Infinity; let bMinY = Infinity; let bMaxX = -Infinity; let bMaxY = -Infinity;
      for (const sub of subpaths) {
        const transformed = sub.v.map(([vx, vy]) => apply(m, vx, vy));
        outShapes.push({
          ty: "sh",
          ind: 0,
          ks: {
            a: 0,
            k: {
              c: sub.c,
              v: transformed.map(roundPair),
              i: sub.i.map(roundPair),
              o: sub.o.map(roundPair)
            }
          },
          nm: "Path"
        });
        for (const [vx, vy] of transformed) {
          bMinX = Math.min(bMinX, vx); bMinY = Math.min(bMinY, vy);
          bMaxX = Math.max(bMaxX, vx); bMaxY = Math.max(bMaxY, vy);
        }
      }
      return { shapes: outShapes, bounds: { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY } };
    }
    default:
      return null;
  }
}

function verticesToShape(pts: number[][], closed: boolean): { shapes: Record<string, unknown>[]; bounds: Bounds } {
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return {
    shapes: [{
      ty: "sh",
      ind: 0,
      ks: {
        a: 0,
        k: { c: closed, v: pts.map(roundPair), i: pts.map(() => [0, 0]), o: pts.map(() => [0, 0]) }
      },
      nm: "Path"
    }],
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  };
}

function fillItem(source: SvgNodeInfo): Record<string, unknown> {
  const raw = source.style?.fill ?? source.attrs.fill ?? "#000000";
  const color = /^url\(|^none$/i.test(raw) ? "#000000" : raw;
  return {
    ty: "fl",
    c: { a: 0, k: hexToRgb01(color) },
    o: { a: 0, k: 100 },
    r: 1,
    nm: "Fill"
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function boundsOfCenter(cx: number, cy: number, rx: number, ry: number): Bounds {
  return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
}

function matrixOf(node: SvgNodeInfo): Matrix {
  const rt = node.resolvedTransform;
  if (rt && rt.length === 6) return rt as Matrix;
  return [1, 0, 0, 1, 0, 0];
}

function columnScaleX(m: Matrix): number {
  return Math.hypot(m[0]!, m[1]!) || 1;
}

function columnScaleY(m: Matrix): number {
  return Math.hypot(m[2]!, m[3]!) || 1;
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asNum(value: number | string | number[]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (Array.isArray(value)) return value[0] ?? 0;
  return 0;
}

function roundPair(pair: number[]): [number, number] {
  return [round4(pair[0] ?? 0), round4(pair[1] ?? 0)];
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function hexToRgb01(hex: string): number[] {
  const clean = hex.trim().replace(/^#/, "");
  const full = clean.length === 3
    ? clean.split("").map((char) => char + char).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((offset) => round4(Number.parseInt(full.slice(offset, offset + 2), 16) / 255));
}

function viewBoxSize(viewBox: string | undefined): { width?: number; height?: number } {
  if (!viewBox) return {};
  const parts = viewBox.split(/[\s,]+/).map(Number).filter(Number.isFinite);
  return parts.length === 4 ? { width: parts[2], height: parts[3] } : {};
}

function matchPart(targetPart: string, node: SvgNodeInfo): boolean {
  const needle = targetPart.toLowerCase();
  const tokens = [node.nodeId, node.id ?? "", node.semanticLabel ?? "", node.roleGuess]
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  return tokens.some((token) => token.includes(needle) || needle.includes(token));
}

function labelFor(node: SvgNodeInfo, uid: number): string {
  return node.semanticLabel ?? node.roleGuess ?? `layer-${uid}`;
}
