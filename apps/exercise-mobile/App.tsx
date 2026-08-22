import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  MotionPlayer,
  RepCounter,
  beginWorkout,
  buildWorkoutPlan,
  commandFor,
  createWorkout,
  defaultExerciseClips,
  exerciseById,
  initialExerciseState,
  reduceExercise,
  tickExercise,
  tickWorkout,
  workoutStatusLabel
} from "@motion-mcp/motion-runtime";
import type { ExerciseState, PoseSample, WorkoutState } from "@motion-mcp/motion-runtime";
import { SkeletonView } from "./src/SkeletonView";

const EXERCISES = ["squat", "baked-squat", "lunge", "jumping-jack", "bicep-curl", "arm-circles"];

const player = new MotionPlayer();
player.registerClips(defaultExerciseClips());
player.play("idle-breathe", { fadeMs: 1 });

export default function App(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const [state, setState] = useState<ExerciseState>(() => initialExerciseState(performance.now()));
  const [pose, setPose] = useState<PoseSample | null>(null);
  const [statusExtra, setStatusExtra] = useState<string>("");
  const stateRef = useRef(state);
  const workoutRef = useRef<WorkoutState>(createWorkout([]));
  const depthRef = useRef(Infinity);
  const overlayArmedRef = useRef(true);
  const counterRef = useRef(new RepCounter({ enterBelowDeg: 100, exitAboveDeg: 160, minPhaseMs: 300 }));
  const sineStartRef = useRef(performance.now());

  const applyState = (next: ExerciseState): void => {
    stateRef.current = next;
    setState(next);
    const entry = exerciseById(next.exerciseId);
    setStatusExtra(entry?.cueText ?? "");
    const command = commandFor(next);
    if (command.baseClipId !== player.currentBaseClipId()) {
      player.play(command.baseClipId ?? "idle-breathe", { fadeMs: 280 });
    }
  };

  const restartCounter = (exerciseId: string): void => {
    const window = exerciseById(exerciseId)?.repWindow;
    counterRef.current = new RepCounter(window);
  };

  const handleRep = (): void => {
    const current = stateRef.current;
    if (!current.exerciseId) return;
    const shallow = Number.isFinite(depthRef.current) && depthRef.current > 100;
    depthRef.current = Infinity;
    applyState(reduceExercise(current, { type: "rep", atMs: performance.now() }));
    if (shallow) {
      applyState(reduceExercise(stateRef.current, { type: "formWarning", atMs: performance.now() + 1 }));
    }
  };

  useEffect(() => {
    StatusBar.setBarStyle("light-content");
    const frameTimer = setInterval(() => {
      const now = performance.now();
      let next = tickExercise(stateRef.current, now);
      const wr = tickWorkout(workoutRef.current, now);
      workoutRef.current = wr.state;
      if (wr.startedExerciseId) {
        applyState(reduceExercise(next, { type: "start", exerciseId: wr.startedExerciseId, atMs: now }));
        restartCounter(wr.startedExerciseId);
        next = stateRef.current;
      } else if (wr.finished && next.exerciseId) {
        workoutRef.current = createWorkout([]);
        applyState(reduceExercise(next, { type: "stop", atMs: now }));
      }
      const command = commandFor(next);
      if (!command.overlayClipId) overlayArmedRef.current = true;
      else if (overlayArmedRef.current) {
        player.playOverlay(command.overlayClipId, { fadeMs: 120 });
        overlayArmedRef.current = false;
      }
      setPose(player.update(33));
      if (workoutRef.current.phase === "active") forceTick();
    }, 33);

    const repTimer = setInterval(() => {
      if (!stateRef.current.exerciseId) return;
      const periodMs = 2600;
      const phase = ((performance.now() - sineStartRef.current) % periodMs) / periodMs;
      const angle = 168 - 92 * Math.sin(phase * Math.PI * 2);
      if (angle < depthRef.current) depthRef.current = angle;
      if (counterRef.current.feed(angle, performance.now())) handleRep();
    }, 40);

    return () => {
      clearInterval(frameTimer);
      clearInterval(repTimer);
    };
  }, []);

  const [, setUiTick] = useState(0);
  const forceTick = (): void => setUiTick((value) => value + 1);

  const startSingle = (exerciseId: string): void => {
    workoutRef.current = createWorkout([]);
    sineStartRef.current = performance.now();
    applyState(reduceExercise(stateRef.current, { type: "start", exerciseId, atMs: performance.now() }));
    restartCounter(exerciseId);
  };

  const startWorkout = (): void => {
    const plan = buildWorkoutPlan({ totalMs: 45000, seed: Math.floor(performance.now()) });
    workoutRef.current = beginWorkout(createWorkout(plan), performance.now());
    sineStartRef.current = performance.now();
    const first = plan[0]!.exerciseId;
    applyState(reduceExercise(stateRef.current, { type: "start", exerciseId: first, atMs: performance.now() }));
    restartCounter(first);
  };

  const stopAll = (): void => {
    workoutRef.current = createWorkout([]);
    applyState(reduceExercise(stateRef.current, { type: "stop", atMs: performance.now() }));
  };

  const stageHeight = useMemo(() => Math.min(width * 1.05, 430), [width]);
  const command = commandFor(state);
  const label = workoutStatusLabel(
    workoutRef.current,
    (id) => exerciseById(id)?.label ?? id,
    performance.now()
  );

  return (
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>Motion Exercise</Text>
          <Text style={styles.badge}>same runtime as web · any GPU or CPU</Text>
          <View style={[styles.stage, { height: stageHeight }]}>
            <SkeletonView sample={pose} width={width - 24} height={stageHeight} />
          </View>
          <View style={styles.chipRow}>
            {EXERCISES.map((id) => (
              <Pressable
                key={id}
                style={[styles.chip, state.exerciseId === id && styles.chipActive]}
                onPress={() => startSingle(id)}
              >
                <Text style={[styles.chipText, state.exerciseId === id && styles.chipTextActive]}>
                  {exerciseById(id)?.label ?? id}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.ghost} onPress={stopAll}>
              <Text style={styles.text}>Stop</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={startWorkout}>
              <Text style={styles.text}>Start workout</Text>
            </Pressable>
          </View>
          <View style={styles.repsRow}>
            <Text style={styles.reps}>{state.repCount}</Text>
            <Text style={styles.repsLabel}>reps</Text>
          </View>
          <Text style={styles.status}>
            {[label, statusExtra, command.statusText].filter(Boolean).join(" · ")}
          </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0f14" },
  scroll: { alignItems: "center", paddingVertical: 18, gap: 10 },
  title: { color: "#dbe4ee", fontSize: 18, fontWeight: "700" },
  badge: { color: "#7d8b9c", fontSize: 11 },
  stage: { width: "100%", backgroundColor: "#10161f", borderRadius: 14, overflow: "hidden" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, paddingHorizontal: 12 },
  chip: { borderColor: "#1e2836", borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { borderColor: "#e8b04b" },
  chipText: { color: "#dbe4ee", fontSize: 12 },
  chipTextActive: { color: "#e8b04b" },
  row: { flexDirection: "row", gap: 8 },
  ghost: { borderColor: "#1e2836", borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  text: { color: "#dbe4ee", fontSize: 13 },
  repsRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  reps: { color: "#e8b04b", fontSize: 44, fontWeight: "700" },
  repsLabel: { color: "#7d8b9c", fontSize: 13 },
  status: { color: "#7d8b9c", fontSize: 12, textAlign: "center", paddingHorizontal: 20 }
});
