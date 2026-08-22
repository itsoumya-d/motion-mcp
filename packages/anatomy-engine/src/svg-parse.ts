import type { BBox, SvgNode } from "./types.js";

const TRACKED_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon"
]);

export function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(source))) {
    if (match[1]) attrs[match[1]] = match[2] ?? "";
  }
  return attrs;
}

export function parseViewBox(
  svgAttrs: Record<string, string>
): { width: number; height: number } {
  const viewBox = svgAttrs.viewBox ?? svgAttrs.viewbox;
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2] ?? 512, height: parts[3] ?? 512 };
    }
  }
  const width = Number.parseFloat(svgAttrs.width ?? "");
  const height = Number.parseFloat(svgAttrs.height ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  return { width: 512, height: 512 };
}

export function parseSvg(source: string): { roots: SvgNode[]; canvas: { width: number; height: number } } {
  const stack: SvgNode[] = [];
  const roots: SvgNode[] = [];
  let autoId = 0;
  let canvas = { width: 512, height: 512 };
  const tagRegex = /<\/?([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source))) {
    const full = match[0] ?? "";
    const tag = match[1] ?? "";
    if (full.startsWith("</")) {
      const index = findLastStackIndex(stack, tag);
      if (index !== -1) stack.splice(index);
      continue;
    }
    if (!TRACKED_TAGS.has(tag)) continue;
    const attrs = parseAttrs(match[2] ?? "");
    const node: SvgNode = {
      nodeId: attrs.id || `node-${++autoId}`,
      tag,
      id: attrs.id,
      className: attrs.class,
      attrs,
      children: []
    };
    if (tag === "svg") canvas = parseViewBox(attrs);
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (!full.endsWith("/>")) stack.push(node);
  }
  return { roots, canvas };
}

export function flattenSvgNodes(node: SvgNode): SvgNode[] {
  return [node, ...node.children.flatMap(flattenSvgNodes)];
}

function findLastStackIndex(stack: SvgNode[], tag: string): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.tag === tag) return index;
  }
  return -1;
}

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numbers(source: string): number[] {
  return (source.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export function pathPoints(d: string): Array<[number, number]> {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Array<[number, number]> = [];
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const num = (): number => Number.parseFloat(tokens[i++] ?? "0");
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) break;
    if (/[A-Za-z]/.test(token)) {
      cmd = token;
      i += 1;
      if (cmd === "Z" || cmd === "z") {
        cx = sx;
        cy = sy;
        continue;
      }
      continue;
    }
    switch (cmd) {
      case "M":
      case "L":
      case "T":
        cx = num();
        cy = num();
        points.push([cx, cy]);
        break;
      case "m":
      case "l":
      case "t":
        cx += num();
        cy += num();
        points.push([cx, cy]);
        break;
      case "H":
        cx = num();
        points.push([cx, cy]);
        break;
      case "h":
        cx += num();
        points.push([cx, cy]);
        break;
      case "V":
        cy = num();
        points.push([cx, cy]);
        break;
      case "v":
        cy += num();
        points.push([cx, cy]);
        break;
      case "C":
        num();
        num();
        num();
        num();
        cx = num();
        cy = num();
        points.push([cx, cy]);
        break;
      case "c":
        for (let k = 0; k < 4; k += 1) num();
        cx += num();
        cy += num();
        points.push([cx, cy]);
        break;
      case "S":
      case "Q":
        num();
        num();
        cx = num();
        cy = num();
        points.push([cx, cy]);
        break;
      case "s":
      case "q":
        num();
        num();
        cx += num();
        cy += num();
        points.push([cx, cy]);
        break;
      case "A":
        num();
        num();
        num();
        num();
        num();
        cx = num();
        cy = num();
        points.push([cx, cy]);
        break;
      case "a":
        for (let k = 0; k < 5; k += 1) num();
        cx += num();
        cy += num();
        points.push([cx, cy]);
        break;
      default:
        i += 1;
        break;
    }
  }
  return points;
}

function bboxFromPoints(points: Array<[number, number]>): BBox | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function shapeBBox(node: SvgNode): BBox | null {
  const a = node.attrs;
  switch (node.tag) {
    case "rect": {
      const x = toNumber(a.x) ?? 0;
      const y = toNumber(a.y) ?? 0;
      const width = toNumber(a.width);
      const height = toNumber(a.height);
      if (width === undefined || height === undefined) return null;
      return { x, y, width, height };
    }
    case "circle": {
      const cx = toNumber(a.cx) ?? 0;
      const cy = toNumber(a.cy) ?? 0;
      const r = toNumber(a.r);
      if (r === undefined) return null;
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    case "ellipse": {
      const cx = toNumber(a.cx) ?? 0;
      const cy = toNumber(a.cy) ?? 0;
      const rx = toNumber(a.rx);
      const ry = toNumber(a.ry);
      if (rx === undefined || ry === undefined) return null;
      return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
    }
    case "line":
    case "polyline":
    case "polygon":
      return bboxFromPoints(
        numbers(a.points ?? `${a.x1 ?? 0},${a.y1 ?? 0} ${a.x2 ?? 0},${a.y2 ?? 0}`)
          .reduce<Array<[number, number]>>((acc, n, idx) => {
            if (idx % 2 === 0) acc.push([n, 0]);
            else acc[acc.length - 1]![1] = n;
            return acc;
          }, [])
      );
    case "path":
      return bboxFromPoints(pathPoints(a.d ?? ""));
    default:
      return null;
  }
}

function readTranslate(transform: string | undefined): [number, number] {
  if (!transform) return [0, 0];
  const translateMatch = transform.match(/translate\(\s*([-.\d]+)[\s,]+([-.\d]+)?\s*\)/);
  if (translateMatch) {
    return [Number.parseFloat(translateMatch[1] ?? "0"), Number.parseFloat(translateMatch[2] ?? translateMatch[1] ?? "0")];
  }
  const matrixMatch = transform.match(/matrix\(\s*([^)]+)\s*\)/);
  if (matrixMatch) {
    const m = numbers(matrixMatch[1] ?? "");
    return [m[4] ?? 0, m[5] ?? 0];
  }
  return [0, 0];
}

export function nodeBBox(node: SvgNode): BBox | null {
  let box = shapeBBox(node);
  for (const child of node.children) {
    const childBox = nodeBBox(child);
    if (!childBox) continue;
    box = box ? union(box, childBox) : childBox;
  }
  if (!box) return null;
  const [tx, ty] = readTranslate(node.attrs.transform);
  if (tx === 0 && ty === 0) return box;
  return { x: box.x + tx, y: box.y + ty, width: box.width, height: box.height };
}

export function union(a: BBox, b: BBox): BBox {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
