import { DOMParser } from "@xmldom/xmldom";
import {
  type SvgNodeInfo,
  type AssetInfo
} from "@motion-mcp/shared-types";
import { parseCssRules, matchingDeclarations, type CssRule } from "./css.js";
import { IDENTITY, multiply, transformToMatrix, type Matrix } from "./transforms.js";

export { transformToMatrix, applyMatrix, multiply, IDENTITY } from "./transforms.js";
export type { Matrix } from "./transforms.js";
export { parseCssRules, matchingDeclarations } from "./css.js";
export type { CssRule } from "./css.js";

export interface SvgGradientStop {
  offset: string;
  color: string;
  opacity?: number;
}

export interface SvgGradientInfo {
  gradientId: string;
  kind: "linear" | "radial";
  stops: SvgGradientStop[];
  coords: Record<string, number>;
  href?: string;
}

export type SvgDimensions = AssetInfo["dimensions"];

export interface SvgParseResult {
  roots: SvgNodeInfo[];
  dimensions: SvgDimensions;
  gradients: Record<string, SvgGradientInfo>;
  warnings: string[];
}

const PAINT_PROPERTIES = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "display",
  "visibility"
]);

type XmlElement = import("@xmldom/xmldom").Element;

interface WalkContext {
  warnings: string[];
  cssRules: CssRule[];
  elementsById: Map<string, XmlElement>;
  gradients: Record<string, SvgGradientInfo>;
  autoId: number;
}

type StyleRecord = Record<string, string>;

/**
 * Parses an SVG document with a real XML parser.
 *
 * Handles what the previous regex scanner could not:
 * - multi-line attributes, comments, CDATA, entities, self-closing nesting
 * - every element (not a 12-tag whitelist), namespaced tags normalized
 * - <style> CSS rules + inline style + presentation-attribute cascade
 * - transform composition down the tree into one resolved matrix
 * - <use href="#id"> expansion with cycle protection
 * - gradient registry (linear/radial stops and coords)
 */
export function parseSvgDocument(source: string): SvgParseResult {
  const ctx: WalkContext = {
    warnings: [],
    cssRules: [],
    elementsById: new Map(),
    gradients: {},
    autoId: 0
  };

  let doc: ReturnType<DOMParser["parseFromString"]>;
  try {
    const parser = new DOMParser({
      onError: (level, message) => {
        if (level === "warning") return;
        if (ctx.warnings.length < 16) ctx.warnings.push(`xml[${level}]: ${message}`);
      }
    });
    doc = parser.parseFromString(source, "image/svg+xml");
  } catch (error) {
    return {
      roots: [],
      dimensions: {},
      gradients: {},
      warnings: [`parse failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  const root = doc.documentElement as unknown as XmlElement | null;
  if (!root) {
    return { roots: [], dimensions: {}, gradients: {}, warnings: ["no document element"] };
  }

  collectIdsAndStyles(root, ctx);

  const roots = elementChildren(root)
    .map((child) => walkElement(child, IDENTITY, {}, false, 1, 0, ctx))
    .filter((node): node is SvgNodeInfo => node !== null);

  const rootTag = localName(root);
  const tree: SvgNodeInfo[] =
    rootTag === "svg"
      ? [walkElement(root, IDENTITY, {}, false, 1, 0, ctx)].filter(
          (node): node is SvgNodeInfo => node !== null
        )
      : roots;

  return {
    roots: tree,
    dimensions: dimensionsFromAttrs(attrsOf(root)),
    gradients: ctx.gradients,
    warnings: ctx.warnings
  };
}

/** Drop-in replacement for the legacy regex-based tree builder. */
export function parseSvgTree(source: string): SvgNodeInfo[] {
  return parseSvgDocument(source).roots;
}

export function parseSvgDimensions(source: string): SvgDimensions {
  return parseSvgDocument(source).dimensions;
}

function collectIdsAndStyles(el: XmlElement, ctx: WalkContext): void {
  const attrs = attrsOf(el);
  const tag = localName(el);
  if (attrs.id) ctx.elementsById.set(attrs.id, el);
  if (tag === "style") {
    const text = textOf(el);
    if (text.trim()) ctx.cssRules.push(...parseCssRules(text));
  }
  for (const child of elementChildren(el)) {
    collectIdsAndStyles(child, ctx);
  }
}

function walkElement(
  el: XmlElement,
  parentMatrix: Matrix,
  inheritedStyle: StyleRecord,
  parentHidden: boolean,
  parentOpacity: number,
  depth: number,
  ctx: WalkContext,
  useChain: Set<string> = new Set()
): SvgNodeInfo | null {
  const tag = localName(el);
  const attrs = attrsOf(el);
  const classList = (attrs.class ?? "").split(/\s+/).filter(Boolean);

  if (tag === "linearGradient" || tag === "radialGradient") {
    registerGradient(tag, el, attrs, ctx);
    return null;
  }
  if (tag === "style") {
    // rules were pre-collected in the first pass
    return null;
  }
  if (tag === "defs" || tag === "symbol" || tag === "mask" || tag === "clipPath" || tag === "filter" || tag === "pattern") {
    // referenced content: register any gradients inside, emit nothing into the tree
    for (const child of elementChildren(el)) {
      const childTag = localName(child);
      if (childTag === "linearGradient" || childTag === "radialGradient") {
        registerGradient(childTag, child, attrsOf(child), ctx);
      }
    }
    return null;
  }

  const cssDecls = matchingDeclarations(ctx.cssRules, tag, attrs.id, classList);
  const inlineStyle = parseStyleAttr(attrs.style);

  const presentation: StyleRecord = {};
  for (const key of Object.keys(attrs)) {
    if (PAINT_PROPERTIES.has(key)) presentation[key] = attrs[key]!;
  }

  const style: StyleRecord = { ...inheritedStyle };
  for (const layer of [presentation, cssDecls, inlineStyle]) {
    for (const [key, value] of Object.entries(layer)) {
      if (value && value !== "inherit") style[key] = value;
    }
  }

  const hidden =
    parentHidden || style.display === "none" || style.visibility === "hidden";
  // Own opacity comes only from this element's own declarations — inherited
  // opacity is already folded into parentOpacity.
  const ownRaw =
    inlineStyle.opacity ?? cssDecls.opacity ?? presentation.opacity;
  const ownOpacity = ownRaw === undefined ? 1 : clamp01(Number.parseFloat(ownRaw));
  const opacity = parentOpacity * (Number.isFinite(ownOpacity) ? ownOpacity : 1);

  const matrix = multiply(parentMatrix, transformToMatrix(attrs.transform));
  const resolvedTransform = matrixEquals(matrix, IDENTITY) ? undefined : [...matrix];

  const node: SvgNodeInfo = {
    nodeId: attrs.id || `node-${++ctx.autoId}`,
    tag,
    id: attrs.id,
    className: attrs.class,
    roleGuess: guessRole(tag, attrs),
    semanticLabel: guessSemanticLabel(tag, attrs),
    attrs,
    children: [],
    style,
    resolvedTransform,
    opacity: opacity < 1 ? Number(opacity.toFixed(4)) : undefined,
    hidden: hidden || undefined,
    depth
  };

  if (TEXT_TAGS.has(tag)) {
    const text = textOf(el).trim();
    if (text) node.textContent = text;
  }

  if (tag === "use") {
    expandUse(node, attrs, ctx, useChain, (clonedChild) => {
      node.children.push(clonedChild);
    });
    return node;
  }

  let maxChildDepth = depth;
  for (const child of elementChildren(el)) {
    const childTag = localName(child);
    if (TEXT_TAGS.has(tag)) continue;
    if (childTag === "linearGradient" || childTag === "radialGradient") {
      registerGradient(childTag, child, attrsOf(child), ctx);
      continue;
    }
    const childNode = walkElement(
      child,
      matrix,
      style,
      hidden,
      opacity,
      depth + 1,
      ctx,
      useChain
    );
    if (childNode) {
      node.children.push(childNode);
      maxChildDepth = Math.max(maxChildDepth, childNode.depth ?? depth);
    }
  }

  return node;
}

const TEXT_TAGS = new Set(["text", "tspan", "title", "desc"]);

function expandUse(
  container: SvgNodeInfo,
  attrs: Record<string, string>,
  ctx: WalkContext,
  chain: Set<string>,
  push: (node: SvgNodeInfo) => void
): void {
  const href = attrs.href ?? attrs["xlink:href"];
  if (!href || !href.startsWith("#")) return;
  const targetId = href.slice(1);
  if (chain.has(targetId)) {
    ctx.warnings.push(`use cycle detected for #${targetId}`);
    return;
  }
  const target = ctx.elementsById.get(targetId);
  if (!target) {
    ctx.warnings.push(`use references missing #${targetId}`);
    return;
  }
  const translate = `translate(${attrs.x ?? 0} ${attrs.y ?? 0})`;
  const containerMatrix: Matrix =
    container.resolvedTransform && container.resolvedTransform.length === 6
      ? [container.resolvedTransform[0]!, container.resolvedTransform[1]!, container.resolvedTransform[2]!, container.resolvedTransform[3]!, container.resolvedTransform[4]!, container.resolvedTransform[5]!]
      : IDENTITY;
  const cloned = walkElement(
    target,
    IDENTITY,
    {},
    Boolean(container.hidden),
    container.opacity ?? 1,
    (container.depth ?? 1) + 1,
    ctx,
    new Set([...chain, targetId])
  );
  if (!cloned) return;
  const existing = cloned.attrs.transform ? `${translate} ${cloned.attrs.transform}` : translate;
  cloned.attrs = { ...cloned.attrs, transform: existing };
  const composed = multiply(containerMatrix, transformToMatrix(existing));
  if (!matrixEquals(composed, IDENTITY)) {
    cloned.resolvedTransform = [...composed];
  } else {
    delete cloned.resolvedTransform;
  }
  push(cloned);
}

function registerGradient(
  kind: "linearGradient" | "radialGradient",
  el: XmlElement,
  attrs: Record<string, string>,
  ctx: WalkContext
): void {
  const id = attrs.id;
  if (!id) return;
  const coords: Record<string, number> = {};
  for (const key of ["x1", "y1", "x2", "y2", "cx", "cy", "r", "fx", "fy"]) {
    const value = Number.parseFloat(attrs[key] ?? "");
    if (Number.isFinite(value)) coords[key] = value;
  }
  const stops: SvgGradientStop[] = [];
  for (const stop of elementChildren(el)) {
    if (localName(stop) !== "stop") continue;
    const stopAttrs = attrsOf(stop);
    const inlineStyle = parseStyleAttr(stopAttrs.style);
    stops.push({
      offset: stopAttrs.offset ?? inlineStyle.stopOffset ?? "0",
      color: stopAttrs["stop-color"] ?? inlineStyle.stopColor ?? "#000000",
      opacity: optionalNumber(stopAttrs["stop-opacity"] ?? inlineStyle.stopOpacity)
    });
  }
  const gradientKind: "linear" | "radial" = kind === "linearGradient" ? "linear" : "radial";
  ctx.gradients[id] = {
    gradientId: id,
    kind: gradientKind,
    stops,
    coords,
    href: stripHash(attrs.href ?? attrs["xlink:href"])
  };
}

function dimensionsFromAttrs(attrs: Record<string, string>): SvgDimensions {
  return {
    width: toNumber(attrs.width),
    height: toNumber(attrs.height),
    viewBox: attrs.viewBox ?? attrs.viewbox
  };
}

function parseStyleAttr(style: string | undefined): StyleRecord {
  const out: StyleRecord = {};
  if (!style) return out;
  for (const chunk of style.split(/;\s*/)) {
    const idx = chunk.indexOf(":");
    if (idx <= 0) continue;
    const key = chunk.slice(0, idx).trim().toLowerCase();
    const value = chunk.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function attrsOf(el: XmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  const attributes = el.attributes;
  if (!attributes) return out;
  for (let index = 0; index < attributes.length; index += 1) {
    const attr = attributes.item(index);
    if (!attr) continue;
    out[localName(attr)] = attr.value;
  }
  return out;
}

function elementChildren(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const children = el.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children.item(index);
    if (child && child.nodeType === 1) out.push(child as unknown as XmlElement);
  }
  return out;
}

function textOf(el: XmlElement): string {
  let out = "";
  const children = el.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children.item(index);
    if (!child) continue;
    if (child.nodeType === 3) out += child.nodeValue ?? "";
    if (child.nodeType === 1) out += textOf(child as unknown as XmlElement);
  }
  return out;
}

function localName(node: { tagName?: string; nodeName?: string; name?: string }): string {
  const raw = node.tagName ?? node.nodeName ?? node.name ?? "";
  return raw.includes(":") ? raw.split(":").pop()! : raw;
}

function stripHash(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("#")) return undefined;
  return value.slice(1);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 0), 1);
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matrixEquals(a: Matrix, b: Matrix, epsilon = 1e-9): boolean {
  return a.every((value, index) => Math.abs(value - b[index]!) < epsilon);
}

export function guessRole(tag: string, attrs: Record<string, string>): string {
  const joined = `${attrs.id ?? ""} ${attrs.class ?? ""} ${attrs["data-name"] ?? ""}`.toLowerCase();
  if (/eye|pupil|iris/.test(joined)) return "eye";
  if (/mouth|smile|lip/.test(joined)) return "mouth";
  if (/hand|arm|leg|foot|wing/.test(joined)) return "limb";
  if (/shadow|shade/.test(joined)) return "shadow";
  if (/spark|star|shine|glow|flare/.test(joined)) return "sparkle";
  if (/needle|dial|tick|gauge|orbit/.test(joined)) return "gauge-part";
  if (/logo|mark|brand/.test(joined)) return "logo-mark";
  if (/ribbon|energy|wave/.test(joined)) return "energy-ribbon";
  if (tag === "path") return "shape-path";
  if (tag === "g") return "group";
  return tag;
}

export function guessSemanticLabel(tag: string, attrs: Record<string, string>): string {
  const explicit = attrs.id || attrs["data-name"] || attrs["aria-label"] || attrs.class;
  if (explicit) {
    return explicit
      .replace(/[_]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/--+/g, "-")
      .toLowerCase();
  }
  return guessRole(tag, attrs);
}

export function flattenSvgNodes(node: SvgNodeInfo): SvgNodeInfo[] {
  return [node, ...node.children.flatMap(flattenSvgNodes)];
}
