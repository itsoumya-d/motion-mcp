import assert from "node:assert/strict";
import test from "node:test";
import {
  BICEP_CURL_CLIP,
  CHEER_CLIP,
  IDLE_CLIP,
  MotionPlayer,
  RepCounter,
  SQUAT_CLIP,
  angleAtDeg,
  commandFor,
  defaultExerciseClips,
  initialExerciseState,
  reduceExercise,
  sampleClip,
  sampleTrack,
  tickExercise
} from "../packages/motion-runtime/src/index.ts";

const approx = (actual: number, expected: number, eps = 1e-6) =>
  Math.abs(actual - expected) <= eps;

test("squat track samples are deterministic and descend then rise", () => {
  const track = SQUAT_CLIP.tracks.thighL!;
  assert.deepEqual(sampleTrack(track, 0), [0, 0, 0]);
  assert.equal(sampleTrack(track, 900)[0], 82);
  const mid = sampleTrack(track, 1200);
  assert.ok(approx(mid[0], 83), `expected ~83 at midpoint, got ${mid[0]}`);
  assert.ok(approx(sampleTrack(track, 2400)[0], 0));
});

test("looped clips wrap continuously", () => {
  const atZero = sampleClip(SQUAT_CLIP, 0);
  const atFull = sampleClip(SQUAT_CLIP, 2400);
  assert.deepEqual(atFull.rotations.thighL, atZero.rotations.thighL);
  const past = sampleClip(SQUAT_CLIP, 2500);
  const atHundred = sampleClip(SQUAT_CLIP, 100);
  assert.deepEqual(past.rotations.thighL, atHundred.rotations.thighL);
});

test("root translation dips during the squat bottom", () => {
  const standing = sampleClip(SQUAT_CLIP, 100);
  const bottom = sampleClip(SQUAT_CLIP, 1500);
  const dip = bottom.translations.root![1];
  assert.ok(dip < -0.3, `expected deep dip, got ${dip}`);
  assert.ok(Math.abs(standing.translations.root?.[1] ?? 0) < 0.05, "near-standing at cycle start");
});

test("player crossfades deterministically and lands on the target clip", () => {
  const runOnce = () => {
    const player = new MotionPlayer();
    player.registerClips(defaultExerciseClips());
    player.play("idle-breathe", { fadeMs: 1 });
    player.update(600);
    player.play("squat", { fadeMs: 500 });
    player.update(250);
    const midPose = player.update(1)!;
    const midThigh = midPose.rotations.thighL?.[0] ?? 0;
    player.update(400);
    const settled = player.update(1)!;
    return { midThigh, settledId: settled.clipId, settledThigh: settled.rotations.thighL![0] };
  };
  const a = runOnce();
  const b = runOnce();
  assert.deepEqual(a, b, "two identical runs must produce identical samples");
  const pureMid = sampleClip(SQUAT_CLIP, 251).rotations.thighL![0];
  assert.ok(a.midThigh > 0 && a.midThigh < pureMid + 5, `blend should sit between poses: ${a.midThigh} vs ${pureMid}`);
  assert.ok(approx(a.settledThigh, sampleClip(SQUAT_CLIP, 652).rotations.thighL![0], 1e-6));
});

test("one-shot clips fire onClipEnd once and release the layer", () => {
  const player = new MotionPlayer();
  let ended = 0;
  player.onClipEnd = () => {
    ended += 1;
  };
  player.registerClips([IDLE_CLIP, CHEER_CLIP]);
  player.play(IDLE_CLIP.id, { fadeMs: 1 });
  player.update(200);
  player.play(CHEER_CLIP.id, { fadeMs: 120 });
  player.update(1400);
  assert.equal(ended, 1);
  player.update(500);
  assert.equal(ended, 1, "end callback must not refire after the layer drains");
});

test("overlays ride on top of the base without evicting it", () => {
  const player = new MotionPlayer();
  player.registerClips(defaultExerciseClips());
  player.play("squat", { fadeMs: 1 });
  player.update(1000);
  assert.equal(player.playOverlay("cheer", { fadeMs: 150 }), true);
  player.update(400);
  assert.equal(player.currentBaseClipId(), "squat");
  assert.equal(player.currentClipId(), "cheer");
  player.update(1400);
  assert.equal(player.currentClipId(), "squat", "base must survive the overlay drain");
  const pose = player.update(0)!;
  const expected = sampleClip(SQUAT_CLIP, 2800).rotations.thighL![0];
  assert.ok(approx(pose.rotations.thighL![0], expected));
});

test("retriggering an active overlay is ignored until it drains", () => {
  const player = new MotionPlayer();
  player.registerClips([SQUAT_CLIP, CHEER_CLIP]);
  player.play(SQUAT_CLIP.id, { fadeMs: 1 });
  player.update(200);
  assert.equal(player.playOverlay(CHEER_CLIP.id, { fadeMs: 100 }), true);
  assert.equal(player.playOverlay(CHEER_CLIP.id, { fadeMs: 100 }), false);
  player.update(1600);
  assert.equal(player.currentClipId(), SQUAT_CLIP.id);
  assert.equal(player.playOverlay(CHEER_CLIP.id, { fadeMs: 100 }), true);
});

test("speed scales playback time without breaking determinism", () => {
  const make = (speed: number) => {
    const player = new MotionPlayer();
    player.speed = speed;
    player.registerClips([BICEP_CURL_CLIP]);
    player.play(BICEP_CURL_CLIP.id, { fadeMs: 1 });
    player.update(800);
    return player.update(1)!;
  };
  const halfSpeed = make(0.5);
  const fullSpeed = make(1);
  const expectedAtHalf = sampleClip(BICEP_CURL_CLIP, (800 + 1) * 0.5).rotations.forearmL![0];
  const expectedAtFull = sampleClip(BICEP_CURL_CLIP, (800 + 1) * 1).rotations.forearmL![0];
  assert.ok(approx(halfSpeed.rotations.forearmL![0], expectedAtHalf));
  assert.ok(approx(fullSpeed.rotations.forearmL![0], expectedAtFull));
});

test("rep counter uses hysteresis and ignores too-fast flicker", () => {
  const counter = new RepCounter({ enterBelowDeg: 95, exitAboveDeg: 160, minPhaseMs: 250 });
  assert.equal(counter.feed(170, 0), false);
  assert.equal(counter.feed(90, 200), false);
  assert.equal(counter.feed(80, 400), false);
  assert.equal(counter.feed(130, 700), false);
  assert.equal(counter.feed(165, 900), true);
  assert.equal(counter.count, 1);

  assert.equal(counter.feed(90, 950), false);
  assert.equal(counter.feed(168, 1000), false, "exit before minPhaseMs must be ignored");
  assert.equal(counter.feed(169, 1250), true, "valid exit after dwell completes the rep");
  assert.equal(counter.count, 2);
  counter.reset();
  assert.equal(counter.count, 0);
});

test("knee angle helper measures interior angle in degrees", () => {
  const straight = angleAtDeg([0, 0, 0], [0, 1, 0], [0, 2, 0]);
  assert.ok(approx(straight, 180));
  const right = angleAtDeg([1, 1, 0], [0, 1, 0], [0, 2, 0]);
  assert.ok(approx(right, 90));
});

test("exercise machine walks idle -> exercising -> overlays -> stop", () => {
  let state = initialExerciseState(0);
  state = reduceExercise(state, { type: "start", exerciseId: "squat", atMs: 100 });
  assert.equal(state.name, "exercising");
  assert.equal(state.exerciseId, "squat");

  state = reduceExercise(state, { type: "rep", atMs: 1200 });
  assert.equal(state.name, "cheering");
  assert.equal(state.repCount, 1);

  state = tickExercise(state, 1800);
  assert.equal(state.name, "cheering", "overlay must persist until its duration elapses");
  state = tickExercise(state, 2301);
  assert.equal(state.name, "exercising");

  state = reduceExercise(state, { type: "formWarning", atMs: 3000 });
  assert.equal(state.name, "correcting");
  state = tickExercise(state, 3901);
  assert.equal(state.name, "exercising");

  state = reduceExercise(state, { type: "rep", atMs: 4000 });
  assert.equal(state.repCount, 2);

  state = reduceExercise(state, { type: "stop", atMs: 5000 });
  assert.equal(state.name, "idle");
  assert.equal(state.exerciseId, null);

  const strayRep = reduceExercise(state, { type: "rep", atMs: 5100 });
  assert.equal(strayRep.repCount, 2, "reps outside a session must not increment");
  assert.equal(strayRep.name, "idle");
});

test("machine commands map states onto registered clip ids", () => {
  let state = initialExerciseState();
  let command = commandFor(state);
  assert.equal(command.baseClipId, "idle-breathe");
  assert.equal(command.overlayClipId, null);

  state = reduceExercise(state, { type: "start", exerciseId: "jumping-jack", atMs: 10 });
  command = commandFor(state);
  assert.equal(command.baseClipId, "jumping-jack");

  state = reduceExercise(state, { type: "rep", atMs: 20 });
  command = commandFor(state);
  assert.equal(command.overlayClipId, "cheer");
  assert.match(command.statusText, /Rep complete/);

  state = tickExercise(state, 1200);
  state = reduceExercise(state, { type: "formWarning", atMs: 1300 });
  command = commandFor(state);
  assert.equal(command.overlayClipId, "correct-form");
});
