import type { SvgNodeInfo } from "@motion-mcp/shared-types";
import { flattenSvgNodes, parseSvgDocument } from "@motion-mcp/svg-parser";
import type { Frame } from "./player.js";

/**
 * Applies a sampled frame to a static SVG source and serializes the result.
 *
 * Matching follows the same convention as emitters: "*" targets a single root
 * wrapper group; named parts match by nodeId / id / semanticLabel / roleGuess
 * tokens. Transform properties compose into one prepended transform attribute.
 */
export function applyFrame(sourceSvg: string, frame: Frame): string {
  const parsed = parseSvgDocument(sourceSvg);
  if (parsed.roots.length === 0) return sourceSvg;
  const root = parsed.roots[0]!;
  applyFrameToTree(root, frame);
  return serializeNodes(parsed.roots);
}

export function applyFrameToTree(root: SvgNodeInfo, frame: Frame): void {
  const flat = flattenSvgNodes(root);
  for (const node of flat) {
    const tokens = partTokens(node);
    const specific = Object.entries(frame).filter(([part]) => part !== "*" && tokensMatch(part, tokens));
    const wildcard = frame["*"];
    const merged: Record<string, number | string | number[]> = {};
    for (const layer of [wildcard, ...specific.map(([, props]) => props)]) {
      if (!layer) continue;
      Object.assign(merged, layer);
    }
    if (Object.keys(merged).length === 0) continue;
    applyProps(node, merged);
  }
}

function applyProps(
  node: SvgNodeInfo,
  props: Record<string, number | string | number[]>
): void {
  const attrs = { ...node.attrs };
  let tx = toNum(props.translateX ?? props.x) ?? 0;
  let ty = toNum(props.translateY ?? props.y) ?? 0;
  let scale = toNum(props.scale);
  const sx = toNum(props.scaleX);
  const sy = toNum(props.scaleY);
  const rotate = toNum(props.rotate);

  const parts: string[] = [];
  if (tx !== 0 || ty !== 0) parts.push(`translate(${round(tx)} ${round(ty)})`);
  if (rotate) parts.push(`rotate(${round(rotate)})`);
  if (scale !== undefined || sx !== undefined || sy !== undefined) {
    const sxv = round(sx ?? scale ?? 1);
    const syv = round(sy ?? scale ?? sx ?? scale ?? 1);
    if (!(sxv === 1 && syv === 1)) parts.push(`scale(${sxv} ${syv})`);
  }

  if (parts.length > 0) {
    const motion = parts.join(" ");
    attrs.transform = attrs.transform ? `${motion} ${attrs.transform}` : motion;
  }

  const opacityProp = toNum(props.opacity as number | undefined);
  if (opacityProp !== undefined) {
    const existing = Number.parseFloat(attrs.opacity ?? "1");
    const base = Number.isFinite(existing) ? existing : 1;
    attrs.opacity = String(round(base * opacityProp));
  }

  for (const paint of ["fill", "stroke"] as const) {
    const value = props[paint];
    if (typeof value === "string") attrs[paint] = value;
  }
  const strokeWidth = toNum(props.strokeWidth as number | undefined);
  if (strokeWidth !== undefined) attrs["stroke-width"] = String(round(strokeWidth));

  node.attrs = attrs;
}

export function partTokens(node: SvgNodeInfo): string[] {
  return [node.nodeId, node.id ?? "", node.semanticLabel ?? "", node.roleGuess]
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

export function tokensMatch(targetPart: string, tokens: string[]): boolean {
  const needle = targetPart.toLowerCase();
  return tokens.some((token) => token.includes(needle) || needle.includes(token));
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const RAW_TEXT_TAGS = new Set(["style", "script"]);
const TEXT_TAGS = new Set(["text", "tspan", "title", "desc"]);

export function serializeNodes(nodes: SvgNodeInfo[]): string {
  return nodes.map(serializeNode).join("");
}

export function serializeNode(node: SvgNodeInfo): string {
  const tag = node.tag;
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`)
    .join(" ");
  const open = `<${tag}${attrs ? ` ${attrs}` : ""}`;

  if (RAW_TEXT_TAGS.has(tag)) {
    return `${open}>${node.textContent ?? ""}</${tag}>`;
  }
  if (node.textContent !== undefined && node.textContent.length > 0) {
    return `${open}>${escapeText(node.textContent)}</${tag}>`;
  }
  if (node.children.length === 0) {
    return `${open}/>`;
  }
  const inner = node.children.map(serializeNode).join("");
  return `${open}>${inner}</${tag}>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
