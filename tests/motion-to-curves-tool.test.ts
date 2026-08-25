import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");

function svgWithPart(partId: string, fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<g id="${partId}"><path d="M10,10L30,10L30,30L10,30Z" fill="${fill}"/></g></svg>`;
}

test("motion_to_curves stages a reviewable diff with eased translate tracks", async () => {
  const { motionCurvesFromTracks } = await import("../packages/mcp-server/src/motion-curves.ts");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motion-curves-tool-"));
  try {
    const result = await motionCurvesFromTracks(root, {
      parts: [
        {
          partId: "part-01",
          label: "Part 01",
          displacementPx: 12,
          frames: [
            {
              partId: "part-01",
              tMs: 0,
              centroid: { x: 20, y: 20 },
              bbox: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
              fill: "#ff0000",
              loop: [
                { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }
              ]
            },
            {
              partId: "part-01",
              tMs: 166,
              centroid: { x: 32, y: 20 },
              bbox: { minX: 22, minY: 10, maxX: 42, maxY: 30 }
            }
          ]
        }
      ],
      partsSvg: svgWithPart("part-01", "#ff0000"),
      sourceLabel: "test-video.mp4"
    });

    // Receipt shape.
    assert.ok(result.diffId.startsWith("diff_"), `diff id shaped: ${result.diffId}`);
    assert.equal(result.assetPath, ".motion-mcp/generated-assets/test-video-mp4-motion.svg");
    assert.ok(result.scenePath.endsWith("scene.json"));
    const tx = result.tracks.find(
      (track) => track.targetPart === "part-01" && track.property === "translateX"
    );
    assert.ok(tx, "eased translate track present in receipt");
    assert.deepEqual(tx.keys.map((key) => [key.t, key.value]), [[0, 0], [166, 12]]);

    // Staged diff exists on disk and carries both artifacts.
    const diffRaw = JSON.parse(
      await fs.readFile(path.join(root, ".motion-mcp", "diffs", `${result.diffId}.json`), "utf8")
    ) as { files: Array<{ path: string; mode: string }>; componentId: string };
    const paths = diffRaw.files.map((file) => file.path);
    assert.deepEqual([...paths].sort(), [
      result.assetPath,
      result.scenePath
    ]);
    for (const file of diffRaw.files) assert.equal(file.mode, "create");

    // Scene artifact embeds tracks + persistent layers.
    const scene = JSON.parse(await fs.readFile(path.join(root, result.scenePath), "utf8")) as {
      artboards: Array<{
        layers: Array<{ layerId: string; targetParts: string[] }>;
        clips: Record<string, { durationMs: number; loop: boolean }>;
      }>;
    };
    const artboard = scene.artboards[0]!;
    assert.equal(artboard.layers.length >= 1, true);
    assert.deepEqual(artboard.layers[0]!.targetParts, ["part-01"]);
    const clipName = Object.keys(artboard.clips)[0]!;
    assert.equal(artboard.clips[clipName]!.loop, true);
    assert.ok(artboard.clips[clipName]!.durationMs >= 166);

    // Asset indexed for downstream tools (generate_animation / capture_gif).
    const indexRaw = JSON.parse(
      await fs.readFile(path.join(root, ".motion-mcp", "assets.json"), "utf8")
    ) as { assets: Array<{ id: string; path: string }> };
    assert.ok(indexRaw.assets.some((asset) => asset.path === result.assetPath), "asset indexed");

    assert.deepEqual(result.nextTools, ["generate_animation", "capture_gif"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
