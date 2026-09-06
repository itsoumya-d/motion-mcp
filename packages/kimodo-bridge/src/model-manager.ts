import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Motion3DModelInfo } from "./types.js";

export function getDefaultModelDir(): string {
  return path.join(os.homedir(), ".motion-mcp", "models");
}

export async function validateModel(modelPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(modelPath);
    if (!stats.isFile()) return false;
    if (stats.size < 1024) return false; // Too small to be a GGUF
    
    // Check GGUF magic bytes 'GGUF'
    const fd = await fs.open(modelPath, 'r');
    const buffer = Buffer.alloc(4);
    await fd.read(buffer, 0, 4, 0);
    await fd.close();
    
    return buffer.toString('utf-8') === 'GGUF';
  } catch {
    return false;
  }
}

export async function getModelInfo(modelPath: string): Promise<Motion3DModelInfo | null> {
  const isValid = await validateModel(modelPath);
  if (!isValid) return null;

  const stats = await fs.stat(modelPath);
  
  // In a real implementation, we would parse the GGUF header here
  // to extract parameter count, metadata, etc.
  
  return {
    id: path.basename(modelPath, ".gguf"),
    name: path.basename(modelPath),
    backend: "kimodo.cpp", // default assumption for GGUF here
    fileSize: stats.size,
    capabilities: ["text-to-motion"]
  };
}

export async function listLocalModels(configDir?: string): Promise<Motion3DModelInfo[]> {
  const dir = configDir ?? getDefaultModelDir();
  const models: Motion3DModelInfo[] = [];

  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith(".gguf")) {
        const fullPath = path.join(dir, file);
        const info = await getModelInfo(fullPath);
        if (info) {
          models.push(info);
        }
      }
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  return models;
}
