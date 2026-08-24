import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodePng } from "../packages/capture/src/index.ts";
import { assembleVideo, hasFfmpeg } from "../packages/capture/src/video.ts";
import { inferRigFromTracks } from "../packages/anatomy-engine/src/index.ts";
import {
  extractVideoFrames,
  trackPartsAcrossFrames,
  vectorizeFrames
} from "../packages/vectorizer/src/index.ts";

function solidFramePng(
  size: number,
  paint: (x: number, y: number) => [number, number, number]
): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const [r, g, b] = paint(x, y);
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

test(
  "real-video rig proposal: mp4 -> extract -> vectorize -> track -> SceneRig",
  { skip: !hasFfmpeg() },
  async () => {
    // A red block slides right across a static dark background over ~2s at 6fps.
    const size = 32;
    const frames: Uint8Array[] = [];
    for (let step = 0; step <= 8; step += 1) {
      frames.push(...Array(2).fill(solidFramePng(size, (x, y) => {
        if (y >= 16) return [20, 20, 24];
        if (x >= step * 3 && x < step * 3 + 10) return [210, 40, 40];
        return [245, 245, 245];
      })));
    }
    const video = await assembleVideo({ frames, fps: 6, format: "mp4" });
    assert.ok(video.byteLength > 0);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "motion-rigvideo-"));
    try {
      const videoPath = path.join(dir, "in.mp4");
      await fs.writeFile(videoPath, video);
      const extracted = await extractVideoFrames(videoPath, { fps: 6, hardCap: 48 });
      assert.ok(extracted.length >= 2);

      const result = vectorizeFrames(extracted, {
        fps: 6,
        maxColors: 5,
        maxKeyframes: 12,
        keepTraces: true
      });
      assert.ok(result.traces, "traces retained for tracking");

      const tracked = trackPartsAcrossFrames(result.traces, {
        canvas: { width: result.width, height: result.height }
      });
      assert.ok(tracked.parts.length >= 2, `expected >=2 tracked parts, got ${tracked.parts.length}`);
      assert.ok(tracked.parts.some((part) => part.displacementPx > 0), "the red block moved");

      const proposal = inferRigFromTracks(tracked.parts, {
        canvas: { width: result.width, height: result.height }
      });
      assert.equal(proposal.rig.bones.length >= 2, true);
      const root = proposal.rig.bones.find((bone) => !bone.parentBoneId);
      assert.ok(root, "exactly one root bone");
      for (const bone of proposal.rig.bones) {
        for (const partId of bone.targetParts) {
          assert.ok(tracked.parts.some((part) => part.partId === partId), `unknown part ${partId}`);
        }
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
);
