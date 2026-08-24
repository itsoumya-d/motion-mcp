import assert from "node:assert/strict";
import test from "node:test";
import { SCENE_FORMAT_VERSION } from "../packages/scene-graph/src/index.ts";
import { attachVideoRig } from "../packages/mcp-server/src/video-rig.ts";
import type { SceneDoc } from "../packages/scene-graph/src/index.ts";

function emptyDoc(): SceneDoc {
  return {
    formatVersion: SCENE_FORMAT_VERSION,
    sceneId: "scene_test",
    name: "test",
    createdAt: "2026-08-24T00:00:00.000Z",
    artboards: [
      {
        artboardId: "flipbook",
        name: "vectorized flipbook",
        layers: [],
        clips: {},
        stateMachines: [],
        bindings: [],
        listeners: [],
        audioEvents: []
      }
    ]
  };
}

function sample(partId: string, tMs: number, cx: number, cy: number) {
  return {
    partId,
    tMs,
    centroid: { x: cx, y: cy },
    bbox: { minX: cx - 15, minY: cy - 15, maxX: cx + 15, maxY: cy + 15 }
  };
}

test("attachVideoRig attaches a SceneRig and returns a reviewable proposal", () => {
  const doc = emptyDoc();
  const tracks = [
    {
      partId: "part-01",
      label: "Part 01",
      displacementPx: 2,
      frames: [sample("part-01", 0, 100, 110), sample("part-01", 83, 102, 110)]
    },
    {
      partId: "part-02",
      label: "Part 02",
      displacementPx: 36,
      frames: [sample("part-02", 0, 150, 60), sample("part-02", 83, 186, 60)]
    }
  ];

  const proposal = attachVideoRig(doc, tracks, { canvas: { width: 200, height: 200 } });

  assert.equal(proposal.partsTracked, 2);
  assert.equal(proposal.bonesProposed, 2);
  assert.equal(proposal.skippedReason, undefined);
  const rig = doc.artboards[0]!.rig;
  assert.ok(rig, "artboard gains a rig block");
  assert.equal(rig!.bones.length, 2);
  // Every bone target must reference a tracked part id.
  for (const bone of rig!.bones) {
    for (const partId of bone.targetParts) {
      assert.ok(tracks.some((t) => t.partId === partId), `bone targets unknown part ${partId}`);
    }
  }
});

test("attachVideoRig skips cleanly when tracking is degenerate", () => {
  const doc = emptyDoc();
  const lonely = [
    { partId: "part-01", label: "Part 01", displacementPx: 0, frames: [sample("part-01", 0, 50, 50)] }
  ];

  const proposal = attachVideoRig(doc, lonely);

  assert.equal(proposal.skippedReason !== undefined, true, "degenerate input reports why");
  assert.equal(doc.artboards[0]!.rig, undefined, "no rig attached for a single static part");
});
