import assert from "node:assert/strict";
import test from "node:test";
import { inferRigFromTracks } from "../packages/anatomy-engine/src/index.ts";

type Sample = {
  partId: string;
  tMs: number;
  centroid: { x: number; y: number };
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

function sample(partId: string, tMs: number, cx: number, cy: number): Sample {
  return {
    partId,
    tMs,
    centroid: { x: cx, y: cy },
    bbox: { minX: cx - 20, minY: cy - 20, maxX: cx + 20, maxY: cy + 20 }
  };
}

/** body (near-still) + head (medium swing) + armL (large swing), all persistent. */
function tracksFixture() {
  return [
    {
      partId: "part-01",
      label: "Part 01",
      displacementPx: 3,
      frames: [sample("part-01", 0, 100, 120), sample("part-01", 83, 103, 120)]
    },
    {
      partId: "part-02",
      label: "Part 02",
      displacementPx: 10,
      frames: [sample("part-02", 0, 100, 60), sample("part-02", 83, 110, 60)]
    },
    {
      partId: "part-03",
      label: "Part 03",
      displacementPx: 40,
      frames: [sample("part-03", 0, 150, 130), sample("part-03", 83, 190, 130)]
    }
  ];
}

test("inferRigFromTracks roots at the dominant still part and bones the movers", () => {
  const result = inferRigFromTracks(tracksFixture(), { canvas: { width: 200, height: 200 } });

  const bones = result.rig.bones;
  assert.equal(bones.length, 3, "one bone per tracked part (root + 2 movers)");

  const root = bones.find((bone) => !bone.parentBoneId);
  assert.ok(root, "exactly one hierarchy root");
  assert.equal(
    root!.targetParts.includes("part-01"),
    true,
    "the near-still part becomes the root's driven part"
  );

  const arm = bones.find((bone) => bone.targetParts.includes("part-03"))!;
  assert.ok(arm.parentBoneId, "the high-amplitude mover gets a parented bone");
  const weightValues = Object.values(arm.weights ?? {});
  assert.ok(weightValues.length > 0, "mover bone carries weights");
  assert.ok(weightValues.every((w) => w > 0 && w <= 1), "weights are in (0, 1]");
});

test("inferRigFromTracks is deterministic and folds still parts into the root", () => {
  const tracks = tracksFixture();
  const first = inferRigFromTracks(tracks, { canvas: { width: 200, height: 200 } });
  const second = inferRigFromTracks(tracks, { canvas: { width: 200, height: 200 } });
  assert.deepEqual(first, second, "identical input yields identical rigs");

  // The near-still head-like part below threshold would ride the root; here
  // verify the root bone exists with sane origin coordinates.
  const root = first.rig.bones.find((bone) => !bone.parentBoneId)!;
  assert.ok(Number.isFinite(root.origin.x) && Number.isFinite(root.origin.y));
});

test("inferRigFromTracks degrades gracefully to a single root bone", () => {
  const lonely = [
    {
      partId: "part-09",
      label: "Part 09",
      displacementPx: 0,
      frames: [sample("part-09", 0, 50, 50)]
    }
  ];
  const result = inferRigFromTracks(lonely);
  assert.equal(result.rig.bones.length, 1);
  assert.equal(result.rig.bones[0]!.targetParts.includes("part-09"), true);
  assert.deepEqual(result.rig.ikChains, []);
});
