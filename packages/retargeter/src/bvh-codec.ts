import type { MotionSequence3D, SmplxSkeleton, SmplxFrame, JointRotation } from "@motion-mcp/shared-types";
import type { BvhData, BvhJoint } from "./types.js";

function parseHierarchy(lines: string[], lineIndex: { val: number }): BvhJoint | null {
  if (lineIndex.val >= lines.length) return null;

  let line = lines[lineIndex.val]!.trim();
  let name = "Root";

  if (line.startsWith("ROOT") || line.startsWith("JOINT")) {
    name = line.split(" ")[1] || "Joint";
  } else if (line.startsWith("End Site")) {
    name = "EndSite";
  }

  lineIndex.val++;
  if (lines[lineIndex.val]?.trim() !== "{") {
    throw new Error("Expected {");
  }
  lineIndex.val++;

  let offset: [number, number, number] = [0, 0, 0];
  let channels: string[] = [];
  const children: BvhJoint[] = [];

  while (lineIndex.val < lines.length) {
    line = lines[lineIndex.val]!.trim();

    if (line.startsWith("OFFSET")) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      offset = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    } else if (line.startsWith("CHANNELS")) {
      channels = line.split(/\s+/).slice(2);
    } else if (line.startsWith("JOINT") || line.startsWith("End Site")) {
      const child = parseHierarchy(lines, lineIndex);
      if (child) children.push(child);
      continue;
    } else if (line === "}") {
      lineIndex.val++;
      break;
    }
    lineIndex.val++;
  }

  return { name, offset, channels, children };
}

export function parseBvh(content: string): BvhData {
  const lines = content.split(/\r?\n/);
  const lineIndex = { val: 0 };

  let hierarchy: BvhJoint | null = null;
  let frameCount = 0;
  let frameTime = 0;
  const frames: number[][] = [];

  while (lineIndex.val < lines.length) {
    const line = lines[lineIndex.val]!.trim();
    if (line === "HIERARCHY") {
      lineIndex.val++;
      hierarchy = parseHierarchy(lines, lineIndex);
    } else if (line === "MOTION") {
      lineIndex.val++;
      while (lineIndex.val < lines.length) {
        const motionLine = lines[lineIndex.val]!.trim();
        if (motionLine.startsWith("Frames:")) {
          frameCount = parseInt(motionLine.split(":")[1]!.trim(), 10);
        } else if (motionLine.startsWith("Frame Time:")) {
          frameTime = parseFloat(motionLine.split(":")[1]!.trim());
        } else if (motionLine.length > 0) {
          frames.push(motionLine.split(/\s+/).map(Number));
        }
        lineIndex.val++;
      }
    } else {
      lineIndex.val++;
    }
  }

  if (!hierarchy) throw new Error("No hierarchy found in BVH");

  return { hierarchy, frameCount, frameTime, frames };
}

export function bvhToMotionSequence(bvh: BvhData): MotionSequence3D {
  const fps = bvh.frameTime > 0 ? Math.round(1 / bvh.frameTime) : 30;
  const frameCount = bvh.frameCount;
  const durationMs = (frameCount / fps) * 1000;

  const flattenJoints = (joint: BvhJoint, list: BvhJoint[] = []): BvhJoint[] => {
    list.push(joint);
    joint.children.forEach((c) => flattenJoints(c, list));
    return list;
  };
  const joints = flattenJoints(bvh.hierarchy).filter((j) => j.name !== "EndSite");

  const skeleton: SmplxSkeleton = {
    joints: joints.map((j, idx) => ({
      name: j.name as any,
      index: idx,
      parentIndex: idx === 0 ? -1 : 0
    }))
  };

  const frames: SmplxFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const row = bvh.frames[i] || [];
    const rootTranslation: [number, number, number] = [
      row[0] || 0,
      row[1] || 0,
      row[2] || 0
    ];

    const jointRotations: JointRotation[] = joints.map((j, idx) => ({
      jointIndex: idx,
      jointName: j.name,
      quaternion: [0, 0, 0, 1]
    }));

    frames.push({
      frameIndex: i,
      rootTranslation,
      jointRotations
    });
  }

  return {
    sequenceId: `bvh_${Date.now()}`,
    prompt: "Imported BVH motion",
    fps,
    frameCount,
    durationMs,
    skeleton,
    frames
  };
}

export function motionSequenceToBvh(motion: MotionSequence3D): string {
  const fps = motion.fps || 30;
  const frameTime = (1 / fps).toFixed(6);
  const frameCount = motion.frameCount;

  let bvh = "HIERARCHY\n";
  bvh += "ROOT Hips\n{\n";
  bvh += "  OFFSET 0.00 0.00 0.00\n";
  bvh += "  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n";
  bvh += "  End Site\n  {\n    OFFSET 0.00 10.00 0.00\n  }\n}\n";
  bvh += "MOTION\n";
  bvh += `Frames: ${frameCount}\n`;
  bvh += `Frame Time: ${frameTime}\n`;

  for (const frame of motion.frames) {
    const pos = frame.rootTranslation;
    bvh += `${pos[0].toFixed(4)} ${pos[1].toFixed(4)} ${pos[2].toFixed(4)} 0.0000 0.0000 0.0000\n`;
  }

  return bvh;
}
