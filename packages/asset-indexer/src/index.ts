import { promises as fs } from "node:fs";
import path from "node:path";
import {
  flattenSvgNodes,
  parseSvgDimensions,
  parseSvgTree
} from "@motion-mcp/svg-parser";
import {
  type AssetIndexResult,
  type AssetInfo,
  type AssetType,
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

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
