import * as THREE from "three";
import {
  MotionPlayer,
  RepDepthTracker,
  beginWorkout,
  buildWorkoutPlan,
  clipFromMotionDoc,
  commandFor,
  createWorkout,
  defaultExerciseClips,
  exerciseById,
  initialExerciseState,
  reduceExercise,
  tickExercise,
  tickWorkout,
  workoutRemainingMs,
  workoutStatusLabel
} from "@motion-mcp/motion-runtime";
import type { ExerciseState, WorkoutState } from "@motion-mcp/motion-runtime";
import squatBakedJson from "@motion-mcp/motion-runtime/fixtures/squat.baked.json";
import { applyPose, buildCharacter } from "./character.js";
import { buildMascots, reactToFormWarning, reactToRep, reactToWorkoutDone } from "./mascots.js";
import { startCameraFeed, startSimulatedFeed } from "./repsource.js";
import type { RepFeed } from "./repsource.js";

const stage = document.querySelector<HTMLElement>("#stage")!;
const repCountEl = document.querySelector<HTMLElement>("#rep-count")!;
const statusEl = document.querySelector<HTMLElement>("#status-line")!;
const sourceEl = document.querySelector<HTMLElement>("#count-source")!;
const cameraBtn = document.querySelector<HTMLButtonElement>("#btn-camera")!;
const cameraVideo = document.querySelector<HTMLVideoElement>("#cam")!;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10161f);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 40);
camera.position.set(0, 1.35, 3.15);
camera.lookAt(0, 0.92, 0);

scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x202833, 1.05));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(1.8, 3.2, 2.2);
scene.add(key);
const rim = new THREE.DirectionalLight(0xe8b04b, 0.5);
rim.position.set(-2.2, 1.4, -1.6);
scene.add(rim);

const grid = new THREE.GridHelper(6, 24, 0x27313f, 0x1a222d);
grid.position.y = 0.001;
scene.add(grid);

const rig = buildCharacter();
scene.add(rig.group);

function resize(): void {
  const width = stage.clientWidth || 640;
  const height = stage.clientHeight || 480;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

const player = new MotionPlayer();
player.registerClips(defaultExerciseClips());
player.registerClips([clipFromMotionDoc(squatBakedJson as never)]);
player.play("idle-breathe", { fadeMs: 1 });

let state: ExerciseState = initialExerciseState(performance.now());
let overlayArmed = true;

const depthTracker = new RepDepthTracker(100);
let workout: WorkoutState = createWorkout([]);

const mascots = buildMascots(document.querySelector<HTMLElement>("#mascots")!);
setInterval(() => mascots.human.play("blink"), 3800);
setTimeout(() => setInterval(() => mascots.crow.play("blink"), 4200), 2100);

let simFeed: RepFeed | null = null;
let camFeed: RepFeed | null = null;

function ensureSimulated(exerciseId?: string): void {
  simFeed?.stop();
  const entry = exerciseById(exerciseId ?? state.exerciseId ?? null);
  simFeed = startSimulatedFeed(
    (angle) => depthTracker.sample(angle),
    () => handleRep(),
    { window: entry?.repWindow }
  );
}

function handleRep(): void {
  if (!state.exerciseId) return;
  const shallow = depthTracker.close();
  setState(reduceExercise(state, { type: "rep", atMs: performance.now() }));
  if (shallow) {
    setState(reduceExercise(state, { type: "formWarning", atMs: performance.now() + 1 }));
    reactToFormWarning(mascots.crow);
    reactToFormWarning(mascots.human);
  }
  reactToRep(mascots.human, state.repCount);
  reactToRep(mascots.crow, state.repCount);
}

function updateStatusText(): void {
  const command = commandFor(state);
  const entry = exerciseById(state.exerciseId);
  const label = workoutStatusLabel(workout, (id) => exerciseById(id)?.label ?? id, performance.now());
  statusEl.textContent = [label, entry?.cueText, command.statusText]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function setState(next: ExerciseState): void {
  state = next;
  repCountEl.textContent = String(state.repCount);
  updateStatusText();
  for (const button of document.querySelectorAll<HTMLButtonElement>("button.exercise")) {
    button.classList.toggle("active", button.dataset.exercise === state.exerciseId);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("button.exercise")) {
  button.addEventListener("click", () => {
    const exerciseId = button.dataset.exercise;
    if (!exerciseId) return;
    setState(reduceExercise(state, { type: "start", exerciseId, atMs: performance.now() }));
    ensureSimulated(exerciseId);
  });
}
document.querySelector("#btn-stop")!.addEventListener("click", () => {
  workout = createWorkout([]);
  setState(reduceExercise(state, { type: "stop", atMs: performance.now() }));
  ensureSimulated();
});
document.querySelector("#btn-workout")!.addEventListener("click", () => {
  const plan = buildWorkoutPlan({ totalMs: 45000, seed: Math.floor(performance.now()) });
  workout = beginWorkout(createWorkout(plan), performance.now());
  const first = plan[0]!.exerciseId;
  setState(reduceExercise(state, { type: "start", exerciseId: first, atMs: performance.now() }));
  ensureSimulated(first);
});
document.querySelector("#btn-form")!.addEventListener("click", () => {
  setState(reduceExercise(state, { type: "formWarning", atMs: performance.now() }));
});
document.querySelector<HTMLInputElement>("#tempo")!.addEventListener("input", (event) => {
  player.speed = Number.parseFloat((event.target as HTMLInputElement).value) || 1;
});

cameraBtn.addEventListener("click", async () => {
  if (camFeed) {
    camFeed.stop();
    camFeed = null;
    cameraVideo.classList.remove("active");
    cameraBtn.textContent = "Enable camera counting";
    sourceEl.textContent = "simulated tempo counter active";
    return;
  }
  cameraBtn.disabled = true;
  try {
    camFeed = await startCameraFeed(cameraVideo, {
      onAngle: (angle) => depthTracker.sample(angle),
      onRep: () => handleRep(),
      onReady: () => {
        simFeed?.stop();
        simFeed = null;
        cameraVideo.classList.add("active");
        cameraBtn.textContent = "Disable camera counting";
        sourceEl.textContent = "BlazePose knee-angle counting active";
      },
      onError: (message) => {
        sourceEl.textContent = `camera unavailable (${message}) — simulated counter kept`;
      }
    });
  } catch {
    cameraBtn.textContent = "Enable camera counting";
  } finally {
    cameraBtn.disabled = false;
  }
});

ensureSimulated();

let lastTs = performance.now();
let lastStatusSecond = -1;
function frame(ts: number): void {
  const deltaMs = Math.min(Math.max(ts - lastTs, 0), 50);
  lastTs = ts;
  state = tickExercise(state, performance.now());

  const wr = tickWorkout(workout, performance.now());
  workout = wr.state;
  if (wr.startedExerciseId) {
    setState(reduceExercise(state, { type: "start", exerciseId: wr.startedExerciseId, atMs: performance.now() }));
    ensureSimulated(wr.startedExerciseId);
  } else if (wr.finished && state.exerciseId) {
    workout = createWorkout([]);
    reactToWorkoutDone(mascots.human);
    reactToWorkoutDone(mascots.crow);
    setState(reduceExercise(state, { type: "stop", atMs: performance.now() }));
  }

  const command = commandFor(state);
  if (command.baseClipId !== player.currentBaseClipId()) {
    player.play(command.baseClipId ?? "idle-breathe", { fadeMs: 280 });
  }
  if (!command.overlayClipId) overlayArmed = true;
  else if (overlayArmed) {
    player.playOverlay(command.overlayClipId, { fadeMs: 120 });
    overlayArmed = false;
  }
  const pose = player.update(deltaMs);
  if (pose) applyPose(rig, pose);

  if (workout.phase === "active") {
    const second = Math.ceil(workoutRemainingMs(workout, performance.now()) / 1000);
    if (second !== lastStatusSecond) {
      lastStatusSecond = second;
      updateStatusText();
    }
  } else {
    lastStatusSecond = -1;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setState(state);
