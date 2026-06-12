import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type AssetIndexResult,
  type AssetInfo,
  type AssetType,
  type SvgNodeInfo,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".expo",
  ".turbo",
  ".dart_tool",
  ".motion-mcp",
  "Pods",
  "Library",
  "Temp",
  "obj"
]);

const ASSET_EXTENSIONS = new Set([
  ".svg",
  ".json",
  ".lottie",
  ".riv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif"
]);

const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "defs",
  "linearGradient",
  "radialGradient"
]);

export async function scanAssets(rootPath: string): Promise<AssetIndexResult> {
  const root = path.resolve(rootPath);
  const warnings: string[] = [];
  const files = (await walk(root)).filter((file) => ASSET_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const assets = await Promise.all(files.map((file) => analyzeAsset(root, file, warnings)));
  const indexPath = path.join(root, ".motion-mcp", "assets.json");
  const result: AssetIndexResult = {
    rootPath: root,
    assets: assets.filter((asset): asset is AssetInfo => Boolean(asset)),
    indexPath,
    scannedAt: nowIso(),
    warnings
  };

  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function analyzeAsset(
  root: string,
  file: string,
  warnings: string[]
): Promise<AssetInfo | null> {
  const relativePath = rel(root, file);
  const ext = path.extname(file).toLowerCase();
  const stat = await fs.stat(file);
  const type = detectAssetType(ext);
  const id = stableId("asset", relativePath);

  if (type === "svg") {
    const source = await fs.readFile(file, "utf8");
    const pathTree = parseSvgTree(source);
    const semanticLabels = unique(pathTree.flatMap(flattenSvgNodes).map((node) => node.semanticLabel ?? node.roleGuess));
    return {
      id,
      path: relativePath,
      type,
      dimensions: parseSvgDimensions(source),
      pathTree,
      semanticLabels,
      sizeBytes: stat.size
    };
  }

  if (ext === ".json") {
    try {
      const raw = await fs.readFile(file, "utf8");
      const json = JSON.parse(raw) as {
        v?: string;
        layers?: Array<{ nm?: string; ty?: number }>;
      };
      if (!json.v || !Array.isArray(json.layers)) {
        return null;
      }
      return {
        id,
        path: relativePath,
        type: "lottie",
        semanticLabels: inferLabelsFromName(relativePath),
        lottieLayers: json.layers.map((layer, index) => layer.nm || `layer-${index + 1}`),
        sizeBytes: stat.size
      };
    } catch {
      warnings.push(`${relativePath} looks like JSON but could not be parsed.`);
      return null;
    }
  }

  if (type === "lottie") {
    return {
      id,
      path: relativePath,
      type,
      semanticLabels: inferLabelsFromName(relativePath),
      sizeBytes: stat.size
    };
  }

  return {
    id,
    path: relativePath,
    type,
    semanticLabels: inferLabelsFromName(relativePath),
    sizeBytes: stat.size
  };
}

function parseSvgDimensions(source: string): AssetInfo["dimensions"] {
  const svgOpen = source.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const attrs = parseAttrs(svgOpen);
  const width = toNumber(attrs.width);
  const height = toNumber(attrs.height);
  return {
    width,
    height,
    viewBox: attrs.viewBox ?? attrs.viewbox
  };
}

function parseSvgTree(source: string): SvgNodeInfo[] {
  const stack: SvgNodeInfo[] = [];
  const roots: SvgNodeInfo[] = [];
  let autoId = 0;
  const tagRegex = /<\/?([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source))) {
    const full = match[0] ?? "";
    const tag = match[1] ?? "";
    const attrSource = match[2] ?? "";
    if (!SVG_TAGS.has(tag) || full.startsWith("</")) {
      if (full.startsWith("</")) {
        const index = findLastStackIndex(stack, tag);
        if (index !== -1) {
          stack.splice(index);
        }
      }
      continue;
    }
    const attrs = parseAttrs(attrSource);
    const node: SvgNodeInfo = {
      nodeId: attrs.id || `node-${++autoId}`,
      tag,
      id: attrs.id,
      className: attrs.class,
      attrs,
      roleGuess: guessRole(tag, attrs),
      semanticLabel: guessSemanticLabel(tag, attrs),
      children: []
    };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    if (!full.endsWith("/>")) {
      stack.push(node);
    }
  }
  return roots;
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(source))) {
    if (match[1]) {
      attrs[match[1]] = match[2] ?? "";
    }
  }
  return attrs;
}

function guessRole(tag: string, attrs: Record<string, string>): string {
  const joined = `${attrs.id ?? ""} ${attrs.class ?? ""}`.toLowerCase();
  if (/eye|pupil|iris/.test(joined)) return "eye";
  if (/mouth|smile|lip/.test(joined)) return "mouth";
  if (/hand|arm|leg|foot|wing/.test(joined)) return "limb";
  if (/shadow|shade/.test(joined)) return "shadow";
  if (/spark|star|shine|glow/.test(joined)) return "sparkle";
  if (/needle|dial|tick|gauge/.test(joined)) return "gauge-part";
  if (/logo|mark|brand/.test(joined)) return "logo-mark";
  if (tag === "path") return "shape-path";
  if (tag === "g") return "group";
  return tag;
}

function guessSemanticLabel(tag: string, attrs: Record<string, string>): string {
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

function flattenSvgNodes(node: SvgNodeInfo): SvgNodeInfo[] {
  return [node, ...node.children.flatMap(flattenSvgNodes)];
}

function detectAssetType(ext: string): AssetType {
  if (ext === ".svg") return "svg";
  if (ext === ".riv") return "rive";
  if (ext === ".lottie" || ext === ".json") return "lottie";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  return "unknown";
}

async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await visit(path.join(dir, entry.name));
        }
        continue;
      }
      output.push(path.join(dir, entry.name));
    }
  }
  await visit(root);
  return output;
}

function inferLabelsFromName(relativePath: string): string[] {
  const name = path.basename(relativePath, path.extname(relativePath)).toLowerCase();
  const labels = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (/logo|brand|mark/.test(name)) labels.push("logo");
  if (/heart|like|favorite/.test(name)) labels.push("like-action");
  if (/loader|loading|spinner/.test(name)) labels.push("loading-state");
  if (/empty|blank|zero/.test(name)) labels.push("empty-state");
  if (/success|check/.test(name)) labels.push("success-state");
  if (/error|warning|alert/.test(name)) labels.push("error-state");
  return unique(labels);
}

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function findLastStackIndex(stack: SvgNodeInfo[], tag: string): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.tag === tag) {
      return index;
    }
  }
  return -1;
}
