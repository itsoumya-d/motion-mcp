import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");

interface JsonRpcResponse {
  id?: number | string;
  result?: {
    tools?: Array<{ name: string; description?: string }>;
    content?: Array<{ type: string; text: string }>;
  };
  error?: unknown;
}

test("mcp server exposes 3D motion tools and executes generate_3d_motion over stdio", async () => {
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
    // 1. Initialize
    await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client-3d", version: "0.1.0" }
    });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    // 2. List tools — check 3D tools are present
    const toolsRes = await request(2, "tools/list", {});
    const names = (toolsRes.result?.tools ?? []).map((t) => t.name);

    assert.ok(names.includes("generate_3d_motion"), "Tool generate_3d_motion is registered");
    assert.ok(names.includes("list_3d_backends"), "Tool list_3d_backends is registered");
    assert.ok(names.includes("list_3d_models"), "Tool list_3d_models is registered");
    assert.ok(names.includes("retarget_motion"), "Tool retarget_motion is registered");
    assert.ok(names.includes("export_3d_animation"), "Tool export_3d_animation is registered");
    assert.ok(names.includes("import_bvh"), "Tool import_bvh is registered");
    assert.ok(names.includes("preview_3d_motion"), "Tool preview_3d_motion is registered");
    assert.ok(names.includes("blend_3d_motions"), "Tool blend_3d_motions is registered");
    assert.ok(names.includes("generate_motion_variants"), "Tool generate_motion_variants is registered");
    assert.ok(names.includes("apply_3d_motion_to_asset"), "Tool apply_3d_motion_to_asset is registered");
    assert.ok(names.includes("motion_style_transfer_3d"), "Tool motion_style_transfer_3d is registered");
    assert.ok(names.includes("import_fbx_animation"), "Tool import_fbx_animation is registered");

    // 3. Call list_3d_backends
    const backendsRes = await request(3, "tools/call", {
      name: "list_3d_backends",
      arguments: {}
    });
    const backendsData = JSON.parse(backendsRes.result?.content?.[0]?.text ?? "{}");
    assert.ok(backendsData.backends.some((b: any) => b.name === "mock" && b.available === true));

    // 4. Call generate_3d_motion
    const genRes = await request(4, "tools/call", {
      name: "generate_3d_motion",
      arguments: {
        prompt: "hero walks forward then waves hello",
        durationMs: 1500,
        fps: 30
      }
    });
    const genData = JSON.parse(genRes.result?.content?.[0]?.text ?? "{}");
    assert.equal(genData.ok, true);
    assert.equal(genData.fps, 30);
    assert.equal(genData.frameCount, 45);
    assert.equal(genData.artboard.is3d, true);
    assert.equal(genData.artboard.rig.skeletonType, "smplx");
    assert.equal(genData.artboard.rig.bones.length, 22);

    // 5. Call export_3d_animation (BVH)
    const exportBvhRes = await request(5, "tools/call", {
      name: "export_3d_animation",
      arguments: {
        format: "bvh",
        prompt: "person walks",
        durationMs: 1000
      }
    });
    const bvhData = JSON.parse(exportBvhRes.result?.content?.[0]?.text ?? "{}");
    assert.equal(bvhData.format, "bvh");
    assert.ok(bvhData.content.includes("HIERARCHY"));
    assert.ok(bvhData.content.includes("MOTION"));

    // 6. Call export_3d_animation (React Three Fiber)
    const exportR3fRes = await request(6, "tools/call", {
      name: "export_3d_animation",
      arguments: {
        format: "r3f",
        prompt: "walk forward",
        durationMs: 1000
      }
    });
    const r3fData = JSON.parse(exportR3fRes.result?.content?.[0]?.text ?? "{}");
    assert.equal(r3fData.format, "r3f");
    assert.ok(r3fData.files[0]?.content.includes("useGLTF"));
    assert.ok(r3fData.files[0]?.content.includes("useAnimations"));

    // 7. Call preview_3d_motion
    const previewRes = await request(7, "tools/call", {
      name: "preview_3d_motion",
      arguments: {
        prompt: "jump"
      }
    });
    const previewData = JSON.parse(previewRes.result?.content?.[0]?.text ?? "{}");
    assert.equal(previewData.previewStatus, "ready");
    assert.equal(previewData.jointsTracked, 22);
    assert.ok(Array.isArray(previewData.rootBoundingBox.y));
  } finally {
    child.kill("SIGTERM");
  }
});
