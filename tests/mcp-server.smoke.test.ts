import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");

interface JsonRpcResponse {
  id?: number | string;
  result?: { tools?: Array<{ name: string }> };
  error?: unknown;
}

test("mcp server exposes the anatomy tools over a real stdio session", async () => {
  const child = spawn("node", ["--import", "tsx", "packages/mcp-server/src/index.ts"], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const stderr: string[] = [];
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => stderr.push(chunk));

  const pending = new Map<number, (msg: JsonRpcResponse) => void>();
  let buffer = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const resolve = pending.get(msg.id)!;
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const request = (id: number, method: string, params?: unknown): Promise<JsonRpcResponse> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${method}; stderr=${stderr.join("")}`)),
        30000
      );
      pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`rpc error for ${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg);
      });
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  try {
    await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.0.1" }
    });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const listed = await request(2, "tools/list", {});
    const names = (listed.result?.tools ?? []).map((tool) => tool.name);
    assert.ok(names.includes("analyze_svg_anatomy"), `missing analyze_svg_anatomy; got: ${names.join(", ")}`);
    assert.ok(names.includes("resolve_anatomy_action"), `missing resolve_anatomy_action; got: ${names.join(", ")}`);
    assert.ok(names.includes("curate_workout"), `missing curate_workout; got: ${names.join(", ")}`);

    const curated = await request(3, "tools/call", {
      name: "curate_workout",
      arguments: { totalMinutes: 5, seed: 7 }
    });
    const content = curated.result?.content as Array<{ type: string; text?: string }>;
    const payload = JSON.parse(content.find((part) => part.type === "text")?.text ?? "{}") as {
      steps: Array<{ exerciseId: string; durationMs: number }>;
    };
    assert.ok(Array.isArray(payload.steps) && payload.steps.length >= 1);
    const total = payload.steps.reduce((acc, step) => acc + step.durationMs, 0);
    assert.equal(total, 300000, "curated plan must sum exactly to 5 minutes");
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
});
