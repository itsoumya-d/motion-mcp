import type { MotionSequence3D } from "@motion-mcp/shared-types";
import type { CleanupOptions } from "./types.js";

function slerp(
  q1: [number, number, number, number],
  q2: [number, number, number, number],
  t: number
): [number, number, number, number] {
  let dot = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
  let q2m = [...q2] as [number, number, number, number];
  if (dot < 0) {
    q2m = [-q2[0], -q2[1], -q2[2], -q2[3]];
    dot = -dot;
  }

  const r: [number, number, number, number] = [
    q1[0] + t * (q2m[0] - q1[0]),
    q1[1] + t * (q2m[1] - q1[1]),
    q1[2] + t * (q2m[2] - q1[2]),
    q1[3] + t * (q2m[3] - q1[3])
  ];

  const len = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3]);
  if (len > 0) {
    r[0] /= len;
    r[1] /= len;
    r[2] /= len;
    r[3] /= len;
  }
  return r;
}

export function smoothMotion(motion: MotionSequence3D, windowSize: number = 3): MotionSequence3D {
  const newMotion: MotionSequence3D = JSON.parse(JSON.stringify(motion));
  const halfWindow = Math.floor(windowSize / 2);
  const frameCount = newMotion.frames.length;
  if (frameCount <= 1) return newMotion;

  const jointCount = newMotion.frames[0]?.jointRotations.length || 0;
  for (let j = 0; j < jointCount; j++) {
    for (let i = 0; i < frameCount; i++) {
      const start = Math.max(0, i - halfWindow);
      const end = Math.min(frameCount - 1, i + halfWindow);
      let sum = [0, 0, 0, 0];
      let count = 0;
      for (let k = start; k <= end; k++) {
        let q = motion.frames[k]?.jointRotations[j]?.quaternion;
        if (!q) continue;
        if (k > start) {
          const dot = sum[0] * q[0] + sum[1] * q[1] + sum[2] * q[2] + sum[3] * q[3];
          if (dot < 0) q = [-q[0], -q[1], -q[2], -q[3]];
        }
        sum[0] += q[0];
        sum[1] += q[1];
        sum[2] += q[2];
        sum[3] += q[3];
        count++;
      }
      const len = Math.sqrt(sum[0] * sum[0] + sum[1] * sum[1] + sum[2] * sum[2] + sum[3] * sum[3]);
      if (len > 0 && newMotion.frames[i]?.jointRotations[j]) {
        newMotion.frames[i]!.jointRotations[j]!.quaternion = [
          sum[0] / len,
          sum[1] / len,
          sum[2] / len,
          sum[3] / len
        ];
      }
    }
  }
  return newMotion;
}

export function blendLoop(motion: MotionSequence3D, blendFrames: number = 10): MotionSequence3D {
  const newMotion: MotionSequence3D = JSON.parse(JSON.stringify(motion));
  const totalFrames = newMotion.frames.length;
  if (totalFrames <= blendFrames) return newMotion;

  const jointCount = newMotion.frames[0]?.jointRotations.length || 0;
  for (let i = 0; i < blendFrames; i++) {
    const t = i / blendFrames;
    const idxEnd = totalFrames - blendFrames + i;
    for (let j = 0; j < jointCount; j++) {
      const qStart = newMotion.frames[i]?.jointRotations[j]?.quaternion;
      const qEnd = newMotion.frames[idxEnd]?.jointRotations[j]?.quaternion;
      if (qStart && qEnd) {
        const blended = slerp(qEnd, qStart, t);
        newMotion.frames[idxEnd]!.jointRotations[j]!.quaternion = blended;
        newMotion.frames[i]!.jointRotations[j]!.quaternion = slerp(blended, qStart, 0.5);
      }
    }
  }
  return newMotion;
}

export function removeJitter(motion: MotionSequence3D, threshold: number = 0.05): MotionSequence3D {
  return smoothMotion(motion, 5);
}
