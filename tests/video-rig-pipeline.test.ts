import assert from "node:assert/strict";
import test from "node:test";
import { encodePng } from "../packages/capture/src/index.ts";
import {
  critiqueScene,
  lintCurves
} from "../packages/critic/src/index.ts";
import { verifyExportParity } from "../packages/exporters/src/index.ts";
import { inferRigFromTracks } from "../packages/anatomy-engine/src/index.ts";
import {
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

/** Two flat-color parts; the red block slides right over three keyframes. */
function movingTwoPartFrames(): Uint8Array[] {
  return [0, 6, 12].map((offset) =>
    solidFramePng(48, (x, y) => {
      if (y >= 24) return [24, 24, 24];
      if (x >= offset && x < offset + 14) return [200, 30, 30];
      if (x >= 34 && x < 46) return [30, 120, 240];
      return [250, 250, 250];
    })
  );
}

async function riggedFlipbookDoc() {
  const result = vectorizeFrames(movingTwoPartFrames(), {
    fps: 12,
    maxColors: 5,
    keepTraces: true
  });
  assert.ok(result.traces, "traces retained");
  const tracked = trackPartsAcrossFrames(result.traces, {
    canvas: { width: result.width, height: result.height }
  });
  const proposal = inferRigFromTracks(tracked.parts, {
    canvas: { width: result.width, height: result.height }
  });
  result.doc.artboards[0]!.rig = proposal.rig;
  // Mirror vectorizeVideoAsset: exporters play from the layered SVG source.
  (result.doc.artboards[0] as { sourceSvg?: string }).sourceSvg = result.layeredSvg;
  return { doc: result.doc, proposal, tracked };
}

test("video-derived rig survives curve lint and full critique", async () => {
  const { doc, proposal } = await riggedFlipbookDoc();

  assert.ok(doc.artboards[0]!.rig, "rig attached to flipbook artboard");
  assert.equal(proposal.rig.bones.length >= 2, true);

  // Curve lint runs pure-math over the flipbook morph tracks.
  const curve = lintCurves(doc);
  assert.equal(
    curve.checks.some((check) => check.severity === "fail"),
    false,
    `curve lint failed: ${JSON.stringify(curve.checks.filter((c) => c.severity === "fail"))}`
  );

  // Full critique (structural + curves + render + mock judge).
  const critique = await critiqueScene(doc, { judge: "mock" as never });
  assert.equal(
    critique.checks.some((check) => check.severity === "fail"),
    false,
    `critique failed: ${JSON.stringify(critique.checks.filter((c) => c.severity === "fail"))}`
  );
});

test("rigged flipbook exports to both targets with stop-level parity", async () => {
  const { doc } = await riggedFlipbookDoc();
  const parity = verifyExportParity(doc);
  assert.equal(parity.ok, true, `parity failures: ${JSON.stringify((parity as unknown as { issues?: string[] }).issues ?? [])}`);
});
