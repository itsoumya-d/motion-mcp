import type { SceneClip, SceneKeyframe, SceneTrack } from "@motion-mcp/scene-graph";
import {
  type RivImportResult,
  type RivObject
} from "./importer.js";

/**
 * Keyframe + geometry decoding for .riv files.
 *
 * Maps the core type keys from rive-runtime dev/defs into renderable SVG
 * plus real SceneDoc clips:
 *   Path(12)+Vertex(107)/Straight(5)/CubicDetached(6) → <path d>
 *   SolidColor(18).colorValue(37, ARGB)              → fill
 *   LinearAnimation(31) + KeyedObject(25)/KeyedProperty(26)
 *     + KeyFrameDouble(30)                           → SceneClips
 *
 * Property mapping onto SceneDoc tracks (core ids → track property):
 *   x=13→translateX  y=14→translateY  rotation=15→rotate
 *   scaleX=16  scaleY=17  opacity=18
 */

const VERTEX_TYPES = new Set([5, 6, 34, 35, 36]);
const CUBIC_DETACHED = 6;
const CUBIC_MIRRORED = 35;
const CUBIC_ASYMMETRIC = 34;
// Parametric paths (extend ParametricPath=15)
const ELLIPSE = 4;
const RECTANGLE = 7;
const TRIANGLE = 8;
const POLYGON = 51;
const STAR = 52;
const PARAMETRIC_TYPES = new Set([ELLIPSE, RECTANGLE, TRIANGLE, POLYGON, STAR]);
const PATH_TYPE = 12;
const SOLID_COLOR = 18;
const FILL = 20;
const SHAPE = 3;
// Official rive-runtime core ids (dev/defs/shapes/paint/*).
const LINEAR_GRADIENT = 22;
const RADIAL_GRADIENT = 17;
const GRADIENT_STOP = 19;
// LinearGradient/RadialGradient share these geometry keys; radial radius
// is the distance between start and end.
const GRAD_START_X = 42;
const GRAD_START_Y = 33;
const GRAD_END_X = 34;
const GRAD_END_Y = 35;

interface GradientDef {
  id: string;
  markup: string;
}

/** Per-artboard registry so paints can share one <defs> block. */
interface GradientRegistry {
  byContextId: Map<number, GradientDef>;
  defs: GradientDef[];
}

function newGradientRegistry(): GradientRegistry {
  return { byContextId: new Map(), defs: [] };
}

/**
 * Builds (or reuses) an SVG gradient definition for a Rive
 * Linear/RadialGradient object and returns its paint reference.
 */
function gradientPaint(
  context: ArtboardContext,
  registry: GradientRegistry,
  gradient: RivObject
): string | undefined {
  const existing = registry.byContextId.get(gradient.contextId);
  if (existing) return `url(#${existing.id})`;

  const startX = num(gradient, GRAD_START_X) ?? 0;
  const startY = num(gradient, GRAD_START_Y) ?? 0;
  const endX = num(gradient, GRAD_END_X) ?? 0;
  const endY = num(gradient, GRAD_END_Y) ?? 0;

  const stops = (context.childrenOf.get(gradient.contextId) ?? [])
    .filter((child) => child.typeKey === GRADIENT_STOP)
    .map((stop) => ({
      position: num(stop, 39) ?? 0,
      argb: num(stop, 38) ?? 0xff000000
    }))
    .sort((a, b) => a.position - b.position);
  if (stops.length === 0) return undefined;

  const id = `mcp-grad-${gradient.contextId}`;
  const stopMarkup = stops
    .map((stop) => {
      const css = argbToCss(stop.argb);
      // 8-digit hex carries alpha; 6-digit needs explicit stop-opacity only
      // when it differs from opaque.
      const opacityAttr = css.length === 9 ? "" : ` stop-opacity="1"`;
      return `<stop offset="${fmt(Math.round(clamp01(stop.position) * 1000) / 1000)}" stop-color="${css}"${opacityAttr}/>`;
    })
    .join("");

  let markup: string;
  if (gradient.typeKey === RADIAL_GRADIENT) {
    const radius = Math.hypot(endX - startX, endY - startY);
    markup =
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(startX)}" cy="${fmt(startY)}" r="${fmt(radius)}">${stopMarkup}</radialGradient>`;
  } else {
    markup =
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(startX)}" y1="${fmt(startY)}" x2="${fmt(endX)}" y2="${fmt(endY)}">${stopMarkup}</linearGradient>`;
  }

  const def: GradientDef = { id, markup };
  registry.byContextId.set(gradient.contextId, def);
  registry.defs.push(def);
  return `url(#${id})`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const PROPERTY_MAP: Record<number, string> = {
  13: "translateX",
  14: "translateY",
  15: "rotate",
  16: "scaleX",
  17: "scaleY",
  18: "opacity"
};

export interface DecodedPath {
  contextId: number;
  d: string;
  color: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface DecodedArtboard {
  name?: string;
  width: number;
  height: number;
  sourceSvg: string;
  paths: DecodedPath[];
  clips: Record<string, SceneClip>;
}

interface ArtboardContext {
  index: number;
  objects: RivObject[];
  byContextId: Map<number, RivObject>;
  childrenOf: Map<number, RivObject[]>;
  width?: number;
  height?: number;
  name?: string;
}

function num(object: RivObject, key: number): number | undefined {
  const value = object.properties.find((entry) => entry.key === key)?.value;
  if (!value) return undefined;
  return value.kind === "uint" || value.kind === "float" || value.kind === "color"
    ? value.value
    : undefined;
}

function strProp(object: RivObject): string | undefined {
  const value = object.properties.find((entry) => entry.key === 4)?.value;
  return value?.kind === "string" && value.value.length > 0 ? value.value : undefined;
}

function groupByArtboard(result: RivImportResult): ArtboardContext[] {
  const contexts = new Map<number, ArtboardContext>();
  for (const object of result.objects) {
    if (object.artboardIndex < 0) continue;
    let context = contexts.get(object.artboardIndex);
    if (!context) {
      context = {
        index: object.artboardIndex,
        objects: [],
        byContextId: new Map(),
        childrenOf: new Map()
      };
      contexts.set(object.artboardIndex, context);
    }
    context.objects.push(object);
    if (object.typeKey === 1) {
      context.name = strProp(object);
      context.width = num(object, 7);
      context.height = num(object, 8);
    } else {
      context.byContextId.set(object.contextId, object);
      const parent = num(object, 5) ?? -1;
      const siblings = context.childrenOf.get(parent) ?? [];
      siblings.push(object);
      context.childrenOf.set(parent, siblings);
    }
  }
  return [...contexts.values()].sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function vertexPoint(vertex: RivObject): [number, number] {
  return [num(vertex, 24) ?? 0, num(vertex, 25) ?? 0];
}

function polar(point: [number, number], degrees: number, distance: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [
    Math.round((point[0]! + distance * Math.cos(radians)) * 10000) / 10000,
    Math.round((point[1]! + distance * Math.sin(radians)) * 10000) / 10000
  ];
}

/** Per-vertex handle resolution across every cubic flavor. */
function handlesFor(vertex: RivObject): { inCtrl: [number, number]; outCtrl: [number, number] } {
  const point = vertexPoint(vertex);
  switch (vertex.typeKey) {
    case CUBIC_MIRRORED: {
      // One angle + one distance; handles are collinear and opposite.
      const rotation = num(vertex, 82);
      const distance = num(vertex, 83);
      if (rotation === undefined || distance === undefined) break;
      return { inCtrl: polar(point, rotation + 180, distance), outCtrl: polar(point, rotation, distance) };
    }
    case CUBIC_ASYMMETRIC: {
      // Shared handle line; independent distances along it.
      const rotation = num(vertex, 79);
      if (rotation === undefined) break;
      const inDistance = num(vertex, 80);
      const outDistance = num(vertex, 81);
      return {
        inCtrl: polar(point, rotation, inDistance ?? 0),
        outCtrl: polar(point, rotation + 180, outDistance ?? 0)
      };
    }
    case CUBIC_DETACHED: {
      return {
        inCtrl: polar(point, num(vertex, 84) ?? 0, num(vertex, 85) ?? 0),
        outCtrl: polar(point, num(vertex, 86) ?? 0, num(vertex, 87) ?? 0)
      };
    }
    default:
      break;
  }
  return { inCtrl: point, outCtrl: point };
}

const isCubic = (vertex: RivObject): boolean =>
  vertex.typeKey !== 5 && VERTEX_TYPES.has(vertex.typeKey);

function buildPathData(context: ArtboardContext, path: RivObject): string | null {
  const vertices = (context.childrenOf.get(path.contextId) ?? [])
    .filter((child) => VERTEX_TYPES.has(child.typeKey));
  if (vertices.length < 2) return null;

  const segments: string[] = [];
  const first = vertices[0]!;
  const [x0, y0] = vertexPoint(first);
  segments.push(`M${fmt(x0)} ${fmt(y0)}`);

  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1]!;
    const current = vertices[index]!;
    const [cx, cy] = vertexPoint(current);
    if (isCubic(previous) || isCubic(current)) {
      const out = handlesFor(previous).outCtrl;
      const inCtrl = handlesFor(current).inCtrl;
      segments.push(`C${fmt(out[0])} ${fmt(out[1])} ${fmt(inCtrl[0])} ${fmt(inCtrl[1])} ${fmt(cx)} ${fmt(cy)}`);
    } else {
      segments.push(`L${fmt(cx)} ${fmt(cy)}`);
    }
  }

  segments.push("Z"); // Rive contours close
  return segments.join("");
}

// ---------------------------------------------------------------------------
// Parametric shapes (Ellipse/Rect/Triangle/Polygon/Star)
// ---------------------------------------------------------------------------

function parametricElement(object: RivObject): string | null {
  const x = num(object, 13) ?? 0;
  const y = num(object, 14) ?? 0;
  const w = num(object, 20) ?? 0;
  const h = num(object, 21) ?? 0;
  if (w <= 0 || h <= 0) return null;
  const originX = num(object, 123) ?? 0.5;
  const originY = num(object, 124) ?? 0.5;
  const cx = x - w * (originX - 0.5);
  const cy = y - h * (originY - 0.5);

  switch (object.typeKey) {
    case ELLIPSE:
      return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(w / 2)}" ry="${fmt(h / 2)}"/>`;
    case RECTANGLE: {
      const corners = [num(object, 31) ?? 0, num(object, 161) ?? 0, num(object, 162) ?? 0, num(object, 163) ?? 0];
      const radius = Math.min(Math.max(...corners), Math.min(w, h) / 2);
      const radiusAttr = radius > 0 ? ` rx="${fmt(radius)}" ry="${fmt(radius)}"` : "";
      return `<rect x="${fmt(cx - w / 2)}" y="${fmt(cy - h / 2)}" width="${fmt(w)}" height="${fmt(h)}"${radiusAttr}/>`;
    }
    case TRIANGLE: {
      const left = cx - w / 2;
      const right = cx + w / 2;
      const top = cy - h / 2;
      const bottom = cy + h / 2;
      return `<polygon points="${fmt(cx)},${fmt(top)} ${fmt(right)},${fmt(bottom)} ${fmt(left)},${fmt(bottom)}"/>`;
    }
    case POLYGON:
    case STAR: {
      const count = Math.max(3, Math.round(num(object, 125) ?? (object.typeKey === STAR ? 5 : 3)));
      const innerRadius = object.typeKey === STAR ? num(object, 127) : undefined;
      const points: string[] = [];
      const total = object.typeKey === STAR ? count * 2 : count;
      for (let index = 0; index < total; index += 1) {
        const isInner = object.typeKey === STAR && index % 2 === 1;
        const radius = (isInner ? (innerRadius ?? w / 4) : w / 2);
        const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
        points.push(`${fmt(cx + radius * Math.cos(angle))},${fmt(cy + radius * Math.sin(angle))}`);
      }
      return `<polygon points="${points.join(" ")}"/>`;
    }
    default:
      return null;
  }
}

interface PaintStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Collects paint styles from the path itself and its owning shape:
 * Fill(20)/Stroke(24) wrapping SolidColor(18) → flat colors, or
 * LinearGradient(22)/RadialGradient(17) → shared `<defs>` gradients.
 */
function paintStyleFor(
  context: ArtboardContext,
  ownerContextIds: number[],
  registry?: GradientRegistry
): PaintStyle {
  const style: PaintStyle = {};
  for (const ownerContextId of ownerContextIds) {
    for (const paint of context.childrenOf.get(ownerContextId) ?? []) {
      let kind: "fill" | "stroke" | null = null;
      let argb: number | undefined;
      let gradientRef: string | undefined;
      if (paint.typeKey === FILL || paint.typeKey === STROKE) {
        const children = context.childrenOf.get(paint.contextId) ?? [];
        const solid = children.find((child) => child.typeKey === SOLID_COLOR);
        if (solid) {
          argb = num(solid, 37);
        } else {
          const gradient = children.find(
            (child) => child.typeKey === LINEAR_GRADIENT || child.typeKey === RADIAL_GRADIENT
          );
          if (gradient && registry) {
            gradientRef = gradientPaint(context, registry, gradient);
          }
        }
        kind = paint.typeKey === FILL ? "fill" : "stroke";
      } else if (paint.typeKey === SOLID_COLOR) {
        argb = num(paint, 37);
        kind = "fill";
      } else if (
        registry &&
        (paint.typeKey === LINEAR_GRADIENT || paint.typeKey === RADIAL_GRADIENT)
      ) {
        // Bare gradients act as direct fills (simple files skip the Fill wrapper).
        gradientRef = gradientPaint(context, registry, paint);
        kind = "fill";
      }
      if (kind === null || (argb === undefined && gradientRef === undefined)) continue;
      if (kind === "fill") {
        style.fill = style.fill ?? gradientRef ?? (argb !== undefined ? argbToCss(argb) : undefined);
      } else {
        style.stroke = style.stroke ?? gradientRef ?? (argb !== undefined ? argbToCss(argb) : undefined);
        style.strokeWidth = style.strokeWidth ?? num(paint, 47) ?? 1;
      }
    }
  }
  return style;
}

const STROKE = 24;

function argbToCss(argb: number): string {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  const hex = `${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
  return a === 255 ? `#${hex}` : `#${hex}${a.toString(16).padStart(2, "0")}`;
}

function styleAttrs(style: PaintStyle): string {
  let attrs = "";
  if (style.fill !== undefined) attrs += ` fill="${style.fill}"`;
  if (style.stroke !== undefined) attrs += ` stroke="${style.stroke}" stroke-width="${fmt(style.strokeWidth ?? 1)}"`;
  return attrs;
}

function wrapGroup(contextId: number, inner: string, style: PaintStyle): string {
  return `<g id="mcp-${contextId}"${styleAttrs(style)}>${inner}</g>`;
}

function buildSourceSvg(
  context: ArtboardContext,
  paths: DecodedPath[],
  width: number,
  height: number,
  ownerOfPath: Map<number, RivObject[]>,
  parametrics: RivObject[],
  registry: GradientRegistry
): string {
  const body: string[] = [];
  const handledPaths = new Set<number>();

  // Shapes first: they own paints and their geometry children inherit them.
  for (const shape of context.objects.filter((object) => object.typeKey === SHAPE)) {
    const ownedPaths = (ownerOfPath.get(shape.contextId) ?? [])
      .map((path) => paths.find((candidate) => candidate.contextId === path.contextId))
      .filter((candidate): candidate is DecodedPath => Boolean(candidate));
    const ownedParametrics = parametrics.filter((object) => findOwningShape(context, object.contextId)?.contextId === shape.contextId);
    if (ownedPaths.length === 0 && ownedParametrics.length === 0) continue;
    for (const path of ownedPaths) handledPaths.add(path.contextId);
    for (const object of ownedParametrics) handledPaths.add(object.contextId);

    const inner =
      ownedPaths.map((path) => `<path d="${path.d}"${path.stroke ? "" : ` fill="${path.color}"`}/>`).join("") +
      ownedParametrics.map((object) => parametricElement(object) ?? "").join("");
    const style = paintStyleFor(context, [shape.contextId], registry);
    body.push(wrapGroup(shape.contextId, inner, style));
  }

  // Standalone paths + parametrics.
  for (const path of paths) {
    if (handledPaths.has(path.contextId)) continue;
    const style: PaintStyle = { fill: path.color };
    if (path.stroke !== undefined) {
      style.stroke = path.stroke;
      style.strokeWidth = path.strokeWidth;
    }
    body.push(wrapGroup(path.contextId, `<path d="${path.d}"/>`, style));
  }
  for (const object of parametrics) {
    if (handledPaths.has(object.contextId)) continue;
    const element = parametricElement(object);
    if (!element) continue;
    body.push(wrapGroup(object.contextId, element, { fill: DEFAULT_FILL[object.contextId % DEFAULT_FILL.length] }));
  }

  const defs = registry.defs.map((def) => def.markup).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    (defs ? `<defs>${defs}</defs>` : "") +
    body.join("") +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

function buildClips(context: ArtboardContext): Record<string, SceneClip> {
  const clips: Record<string, SceneClip> = {};
  const animations = context.objects.filter((object) => object.typeKey === 31);
  const keyedObjects = context.objects.filter((object) => object.typeKey === 25);
  const keyedProperties = context.objects.filter((object) => object.typeKey === 26);
  const keyframes = context.objects.filter((object) => object.typeKey === 30);

  for (const animation of animations) {
    const animationCtx = animation.contextId;
    const fps = num(animation, 56) ?? FALLBACK_FPS;
    const durationFrames = num(animation, 57) ?? 0;
    const loopValue = num(animation, 59) ?? 0;
    const durationMs = durationFrames > 0 && fps > 0 ? Math.round((durationFrames / fps) * 1000) : 1000;
    const name = strProp(animation) ?? `animation-${animationCtx}`;

    const tracksByTarget = new Map<number, Map<number, RivObject[]>>();
    for (const keyed of keyedObjects) {
      if (num(keyed, 52) !== animationCtx) continue;
      const target = num(keyed, 51) ?? -1;
      for (const property of keyedProperties) {
        if (num(property, 71) !== keyed.contextId) continue;
        const propertyKey = num(property, 53) ?? -1;
        const frames = keyframes.filter((frame) => num(frame, 72) === property.contextId);
        if (frames.length === 0) continue;
        const targetMap = tracksByTarget.get(target) ?? new Map<number, RivObject[]>();
        targetMap.set(propertyKey, frames);
        tracksByTarget.set(target, targetMap);
      }
    }

    const tracks: SceneTrack[] = [];
    for (const [target, properties] of tracksByTarget) {
      for (const [propertyKey, frames] of properties) {
        const sceneProperty = PROPERTY_MAP[propertyKey];
        if (!sceneProperty) continue;
        const sorted = [...frames].sort((a, b) => (num(a, 67) ?? 0) - (num(b, 67) ?? 0));
        const keys: SceneKeyframe[] = sorted.map((frame) => {
          const easing = interpolationToEasing(num(frame, 68));
          return {
            t: Math.round(((num(frame, 67) ?? 0) / (fps || FALLBACK_FPS)) * 1000),
            value: num(frame, 70) ?? 0,
            ...(easing ? { easing } : {})
          };
        });
        tracks.push({ targetPart: `mcp-${target}`, property: sceneProperty, keys });
      }
    }
    if (tracks.length === 0) continue;

    clips[`clip-riv-anim-${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`] = {
      clipId: `clip-riv-anim-${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
      name,
      durationMs: durationMs > 0 ? durationMs : 1000,
      loop: loopValue !== 0,
      tracks: tracks.map((track) => ({
        ...track,
        keys: [...track.keys].sort((a, b) => a.t - b.t)
      }))
    };
  }
  return clips;
}

const FALLBACK_FPS = 60;

/**
 * Rive's Interpolation enum: hold=0, linear=1, cubic=2+.
 * Linear is the SceneDoc default (omitted); cubic approximates to easeInOut.
 */
function interpolationToEasing(interpolationType: number | undefined): SceneKeyframe["easing"] {
  switch (interpolationType) {
    case 0: return "hold";
    case 2: return "easeInOut";
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function decodeRiv(result: RivImportResult): DecodedArtboard[] {
  const contexts = groupByArtboard(result);
  return contexts.map((context) => {
    const width = Math.max(1, Math.round(context.width ?? 512));
    const height = Math.max(1, Math.round(context.height ?? 512));
    const registry = newGradientRegistry();

    const paths: DecodedPath[] = [];
    const ownerOfPath = new Map<number, RivObject[]>();
    let paletteIndex = 0;
    for (const object of context.objects) {
      const isVertexPath = object.typeKey === PATH_TYPE;
      const isParametric = PARAMETRIC_TYPES.has(object.typeKey);
      if (!isVertexPath && !isParametric) continue;

      let d: string | null | undefined;
      if (isVertexPath) {
        d = buildPathData(context, object);
        if (!d) continue;
      } else if (parametricElement(object) === null) {
        continue;
      }

      const shape = findOwningShape(context, object.contextId);
      if (shape) {
        const list = ownerOfPath.get(object.contextId) ?? [];
        list.push(object);
        ownerOfPath.set(object.contextId, list);
      }

      if (isVertexPath && d) {
        const style = paintStyleFor(context, [
          object.contextId,
          ...(shape ? [shape.contextId] : [])
        ], registry);
        paths.push({
          contextId: object.contextId,
          d,
          color: style.fill ?? DEFAULT_FILL[paletteIndex % DEFAULT_FILL.length],
          stroke: style.stroke,
          strokeWidth: style.strokeWidth
        });
        paletteIndex += 1;
      }
    }

    const parametrics = context.objects.filter((object) => PARAMETRIC_TYPES.has(object.typeKey));

    return {
      name: context.name,
      width,
      height,
      sourceSvg: buildSourceSvg(context, paths, width, height, ownerOfPath, parametrics, registry),
      paths,
      clips: buildClips(context)
    };
  });
}

function findOwningShape(context: ArtboardContext, pathContextId: number): RivObject | undefined {
  // Walk up parentId chains looking for a Shape.
  let cursor = context.byContextId.get(num(context.byContextId.get(pathContextId)!, 5) ?? -1);
  let guard = 0;
  while (cursor && guard < 32) {
    if (cursor.typeKey === SHAPE) return cursor;
    const parentId = num(cursor, 5) ?? -1;
    cursor = context.byContextId.get(parentId);
    guard += 1;
  }
  return undefined;
}

const DEFAULT_FILL = ["#5B7CFA", "#8B5CF6", "#F59E0B", "#10B981", "#EF4444"];

function fmt(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}
