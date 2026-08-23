import { promises as fs } from "node:fs";
import path from "node:path";
import { emitFlutterAnimation } from "@motion-mcp/emitter-flutter";
import { emitReactAnimation } from "@motion-mcp/emitter-react";
import { emitReactNativeAnimation } from "@motion-mcp/emitter-react-native";
import { emitUnityAnimation } from "@motion-mcp/emitter-unity";
import type {
  AssetIndexResult,
  AssetInfo,
  FileChange,
  FrameworkKind,
  GeneratedMotionDiff
} from "@motion-mcp/shared-types";
import { nowIso } from "@motion-mcp/shared-types";

export async function readDiff(root: string, diffId: string): Promise<GeneratedMotionDiff> {
  const file = path.join(root, ".motion-mcp", "diffs", `${diffId}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as GeneratedMotionDiff;
  } catch {
    throw new Error(`Diff ${diffId} was not found. Run generate_animation first.`);
  }
}

export async function writeDiff(root: string, diff: GeneratedMotionDiff): Promise<void> {
  const dir = path.join(root, ".motion-mcp", "diffs");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${diff.diffId}.json`), `${JSON.stringify(diff, null, 2)}\n`, "utf8");
}

export async function loadOptionalJson<T>(root: string, filename: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, ".motion-mcp", filename), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function toUnifiedDiff(files: FileChange[]): string {
  return files
    .map((file) => {
      const body = file.content
        .split(/\r?\n/)
        .map((line) => `+${line}`)
        .join("\n");
      return `--- /dev/null\n+++ b/${file.path}\n@@\n${body}`;
    })
    .join("\n");
}

/** Inserts or replaces one asset entry in the project's assets.json index. */
export async function upsertIndexedAsset(root: string, asset: AssetInfo): Promise<void> {
  const existing = await loadOptionalJson<AssetIndexResult>(root, "assets.json");
  const assets = existing?.assets.filter((candidate) => candidate.id !== asset.id) ?? [];
  assets.push(asset);
  const result: AssetIndexResult = {
    rootPath: root,
    assets,
    indexPath: path.join(root, ".motion-mcp", "assets.json"),
    scannedAt: nowIso(),
    warnings: existing?.warnings ?? []
  };
  await fs.mkdir(path.join(root, ".motion-mcp"), { recursive: true });
  await fs.writeFile(path.join(root, ".motion-mcp", "assets.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function emitForFramework(
  framework: FrameworkKind,
  input: Parameters<typeof emitReactAnimation>[0]
): FileChange[] {
  if (framework === "next" || framework === "react" || framework === "unknown") {
    return emitReactAnimation(input);
  }
  if (framework === "react-native" || framework === "expo") {
    return emitReactNativeAnimation(input);
  }
  if (framework === "flutter") {
    return emitFlutterAnimation(input);
  }
  if (framework === "unity") {
    return emitUnityAnimation(input);
  }
  return emitReactAnimation(input);
}
