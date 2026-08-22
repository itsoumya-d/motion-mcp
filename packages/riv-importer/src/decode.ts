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

const VERTEX_TYPES = new Set([5, 36]); // StraightVertex, CubicVertex base
const CUBIC_DETACHED = 6;
const PATH_TYPE = 12;
const SOLID_COLOR = 18;
const FILL = 20;
const SHAPE = 3;

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

function cubicControls(
  point: [number, number],
  inRotation: number | undefined,
  inDistance: number | undefined,
  outRotation: number | undefined,
  outDistance: number | undefined
): { inCtrl: [number, number]; outCtrl: [number, number] } {
  const rad = (deg: number | undefined, dist: number | undefined): [number, number] => {
    if (deg === undefined || dist === undefined) return point;
    const radians = (deg * Math.PI) / 180;
    return [
      Math.round((point[0]! + dist * Math.cos(radians)) * 10000) / 10000,
      Math.round((point[1]! + dist * Math.sin(radians)) * 10000) / 10000
    ];
  };
  return { inCtrl: rad(inRotation, inDistance), outCtrl: rad(outRotation, outDistance) };
}

function buildPathData(context: ArtboardContext, path: RivObject): string | null {
  const vertices = (context.childrenOf.get(path.contextId) ?? [])
    .filter((child) => VERTEX_TYPES.has(child.typeKey));
  if (vertices.length < 2) return null;

  const segments: string[] = [];
  const first = vertices[0]!;
  const [x0, y0] = vertexPoint(first);
  segments.push(`M${fmt(x0)} ${fmt(y0)}`);

  for (let index = 1; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const [cx, cy] = vertexPoint(current);
    const previous = vertices[index - 1]!;
    if (
      previous.typeKey === CUBIC_DETACHED ||
      current.typeKey === CUBIC_DETACHED
    ) {
      // CubicDetached stores per-vertex handle rotations/distances.
      const prevOut = cubicControls(
        vertexPoint(previous),
        undefined,
        undefined,
        num(previous, 86),
        num(previous, 87)
      ).outCtrl;
      const curIn = cubicControls(
        [cx, cy],
        num(current, 84),
        num(current, 85),
        undefined,
        undefined
      ).inCtrl;
      segments.push(`C${fmt(prevOut[0])} ${fmt(prevOut[1])} ${fmt(curIn[0])} ${fmt(curIn[1])} ${fmt(cx)} ${fmt(cy)}`);
    } else {
      segments.push(`L${fmt(cx)} ${fmt(cy)}`);
    }
  }

  segments.push("Z"); // Rive contours close
  return segments.join("");
}

/** Finds the fill color for a path: sibling solid color, or nearest default. */
function fillColorFor(context: ArtboardContext, path: RivObject, fallback: string): string {
  const candidates = [...(context.childrenOf.get(path.contextId) ?? [])];
  // Paints can hang off an owning Shape rather than the path itself.
  for (const shape of context.objects.filter((object) => object.typeKey === SHAPE)) {
    for (const paint of context.childrenOf.get(shape.contextId) ?? []) {
      candidates.push(paint);
    }
  }
  for (const candidate of candidates) {
    if (candidate.typeKey !== FILL && candidate.typeKey !== SOLID_COLOR) continue;
    const solid =
      candidate.typeKey === SOLID_COLOR
        ? candidate
        : (context.childrenOf.get(candidate.contextId) ?? []).find(
            (child) => child.typeKey === SOLID_COLOR
          );
    if (!solid) continue;
    const argb = num(solid, 37);
    if (argb !== undefined) return argbToCss(argb);
  }
  return fallback;
}

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

function buildSourceSvg(
  context: ArtboardContext,
  paths: DecodedPath[],
  width: number,
  height: number,
  ownerOfPath: Map<number, RivObject[]>
): string {
  const body: string[] = [];
  const renderedOwners = new Set<number>();

  // Render shapes first (they own paints), then standalone paths.
  for (const shape of context.objects.filter((object) => object.typeKey === SHAPE)) {
    const owned = (ownerOfPath.get(shape.contextId) ?? [])
      .map((path) => paths.find((candidate) => candidate.contextId === path.contextId))
      .filter((candidate): candidate is DecodedPath => Boolean(candidate));
    if (owned.length === 0) continue;
    renderedOwners.add(shape.contextId);
    body.push(`<g id="mcp-${shape.contextId}">`);
    for (const path of owned) {
      body.push(`<path d="${path.d}" fill="${path.color}"/>`);
    }
    body.push(`</g>`);
  }
  for (const path of paths) {
    if (renderedOwners.has(path.contextId)) continue;
    body.push(`<g id="mcp-${path.contextId}"><path d="${path.d}" fill="${path.color}"/></g>`);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
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

    const paths: DecodedPath[] = [];
    const ownerOfPath = new Map<number, RivObject[]>();
    let paletteIndex = 0;
    for (const object of context.objects) {
      if (object.typeKey !== PATH_TYPE) continue;
      const d = buildPathData(context, object);
      if (!d) continue;
      // Find owning shape (shape whose descendant chain includes this path).
      const shape = findOwningShape(context, object.contextId);
      if (shape) {
        const list = ownerOfPath.get(shape.contextId) ?? [];
        list.push(object);
        ownerOfPath.set(shape.contextId, list);
      }
      paths.push({
        contextId: object.contextId,
        d,
        color: fillColorFor(context, object, DEFAULT_FILL[paletteIndex % DEFAULT_FILL.length])
      });
      paletteIndex += 1;
    }

    return {
      name: context.name,
      width,
      height,
      sourceSvg: buildSourceSvg(context, paths, width, height, ownerOfPath),
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
