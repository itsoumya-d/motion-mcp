import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MotionPlayer,
  clipFromMotionDoc,
  sampleClip,
  type MotionDocJson
} from "../packages/motion-runtime/src/index.ts";

const FIXTURE = path.resolve(
  import.meta.dirname ?? ".",
  "../packages/motion-runtime/fixtures/squat.baked.json"
);

function loadBaked(): ReturnType<typeof clipFromMotionDoc> {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as MotionDocJson;
  return clipFromMotionDoc(raw);
}

test("python-baked squat loads, sorts keys, and plays through the runtime", () => {
  const clip = loadBaked();
  assert.equal(clip.id, "baked-squat");
  assert.equal(clip.durationMs, 2400);
  assert.equal(clip.loop, true);
  assert.equal(clip.meta?.source, "baked");

  for (const track of Object.values(clip.tracks)) {
    for (let i = 1; i < track.keys.length; i += 1) {
      assert.ok(track.keys[i]!.t >= track.keys[i - 1]!.t, "keys must be time-sorted");
    }
  }

  const player = new MotionPlayer();
  player.registerClips([clip]);
  player.play(clip.id, { fadeMs: 1 });
  player.update(1500);
  const pose = player.update(1)!;
  const thigh = pose.rotations.thighL?.[0] ?? -999;
  assert.ok(thigh > 82 && thigh < 86, `bottom-of-squat thigh angle expected ~84, got ${thigh}`);
  const rootY = pose.translations.root?.[1] ?? 0;
  assert.ok(rootY < -0.3, `root should be dipped at the bottom, got ${rootY}`);
});

test("baked clip matches direct MotionDoc sampling bit-for-bit", () => {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8")) as MotionDocJson;
  const viaPlayer = (() => {
    const player = new MotionPlayer();
    player.registerClips([clipFromMotionDoc(doc)]);
    player.play("baked-squat", { fadeMs: 1 });
    player.update(1200);
    return player.update(1)!;
  })();
  const direct = sampleClip(clipFromMotionDoc(doc), 1201);
  assert.deepEqual(viaPlayer.rotations, direct.rotations);
});

test("malformed MotionDocs are rejected with clear errors", () => {
  assert.throws(() => clipFromMotionDoc({ id: "x", durationMs: 0, loop: true, tracks: {} } as MotionDocJson), /durationMs/);
  assert.throws(() => clipFromMotionDoc({ id: "x", durationMs: 1000, loop: true, tracks: {} } as MotionDocJson), /no usable rotation tracks/);
  assert.throws(
    () =>
      clipFromMotionDoc({
        id: "x",
        durationMs: 1000,
        loop: true,
        tracks: { spine: [[0, Number.NaN, 0, 0], [500, 10, 0, 0]] }
      } as unknown as MotionDocJson),
    /non-finite/
  );
});
