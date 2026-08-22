import { RepCounter, angleAtDeg } from "@motion-mcp/motion-runtime";
import type { RepWindowOptions } from "@motion-mcp/motion-runtime";

export interface RepFeed {
  stop(): void;
  readonly label: string;
}

export function startSimulatedFeed(
  onAngle: (angleDeg: number) => void,
  onRep: () => void,
  options: { periodMs?: number; window?: RepWindowOptions } = {}
): RepFeed {
  const periodMs = options.periodMs ?? 2600;
  const window = options.window ?? { enterBelowDeg: 100, exitAboveDeg: 160, minPhaseMs: 300 };
  const counter = new RepCounter(window);
  const t0 = performance.now();
  let raf = 0;
  const loop = (): void => {
    const now = performance.now();
    const phase = ((now - t0) % periodMs) / periodMs;
    const angle = 168 - 92 * Math.sin(phase * Math.PI * 2);
    onAngle(angle);
    if (counter.feed(angle, now)) onRep();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return { stop: () => cancelAnimationFrame(raf), label: "simulated tempo counter" };
}

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface PoseLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { landmarks?: Landmark[][] };
}

export async function startCameraFeed(
  video: HTMLVideoElement,
  handlers: {
    onAngle: (angleDeg: number) => void;
    onRep: () => void;
    onReady: () => void;
    onError: (message: string) => void;
  }
): Promise<RepFeed> {
  const visionUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  try {
    const vision: any = await import(/* @vite-ignore */ `${visionUrl}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${visionUrl}/wasm`);
    const landmarker: PoseLandmarkerLike = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    video.srcObject = stream;
    await video.play();

    const counter = new RepCounter({ enterBelowDeg: 105, exitAboveDeg: 155, minPhaseMs: 350 });
    let lastTs = -1;
    let raf = 0;
    let stopped = false;
    const point = (l: Landmark): [number, number, number] => [l.x, l.y, l.z ?? 0];
    const loop = (): void => {
      if (stopped) return;
      const now = performance.now();
      if (video.readyState >= 2 && now !== lastTs) {
        lastTs = now;
        const result = landmarker.detectForVideo(video, now);
        const lm = result.landmarks?.[0];
        if (lm && lm.length >= 29) {
          const left = angleAtDeg(point(lm[23]!), point(lm[25]!), point(lm[27]!));
          const right = angleAtDeg(point(lm[24]!), point(lm[26]!), point(lm[28]!));
          const knee = (left + right) / 2;
          handlers.onAngle(knee);
          if (counter.feed(knee, now)) handlers.onRep();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    handlers.onReady();
    return {
      label: "camera pose counter",
      stop: () => {
        stopped = true;
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      }
    };
  } catch (error) {
    handlers.onError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
