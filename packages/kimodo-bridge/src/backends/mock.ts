import { randomUUID } from "node:crypto";
import type {
  Generate3DOptions,
  MotionSequence3D,
  Motion3DModelInfo,
  BackendCapabilities,
  SmplxFrame,
  JointRotation
} from "../types.js";
import type { Motion3DBackend } from "../backend-interface.js";
import { SMPLX_SKELETON } from "../types.js";
import { eulerToQuaternion, identityQuaternion } from "../pose-codec.js";

function getSeededRandom(seed: number) {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

export class MockBackend implements Motion3DBackend {
  readonly name = "mock";
  readonly license = "MIT";

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }

  async generate(prompt: string, options: Generate3DOptions): Promise<MotionSequence3D> {
    const fps = options.fps ?? 30;
    const durationSec = options.durationMs / 1000;
    const frameCount = Math.floor(durationSec * fps);
    const seed = options.seed ?? Math.floor(Math.random() * 1000000);
    const rand = getSeededRandom(seed);

    const type = prompt.toLowerCase().includes("walk")
      ? "walk"
      : prompt.toLowerCase().includes("wave")
      ? "wave"
      : prompt.toLowerCase().includes("jump")
      ? "jump"
      : "idle";

    const frames: SmplxFrame[] = [];

    for (let i = 0; i < frameCount; i++) {
      const t = i / fps;
      const rootTranslation: [number, number, number] = [0, 0, 0];
      const jointRotations: JointRotation[] = SMPLX_SKELETON.joints.map((joint) => ({
        jointIndex: joint.index,
        jointName: joint.name,
        quaternion: identityQuaternion()
      }));

      // Procedural generation logic
      if (type === "walk") {
        rootTranslation[2] = t * 1.5; // move forward
        const legPhase = t * Math.PI * 2; // full cycle per second
        
        // Hip and knee alternation
        const leftHipAngle = Math.sin(legPhase) * 30;
        const rightHipAngle = Math.sin(legPhase + Math.PI) * 30;
        const leftKneeAngle = Math.max(0, Math.sin(legPhase - Math.PI / 2) * 60);
        const rightKneeAngle = Math.max(0, Math.sin(legPhase + Math.PI / 2) * 60);
        
        // Arm swing (opposite to legs)
        const leftShoulderAngle = Math.sin(legPhase + Math.PI) * 20;
        const rightShoulderAngle = Math.sin(legPhase) * 20;

        for (const jr of jointRotations) {
          if (jr.jointName === "left_hip") jr.quaternion = eulerToQuaternion([leftHipAngle, 0, 0]);
          if (jr.jointName === "right_hip") jr.quaternion = eulerToQuaternion([rightHipAngle, 0, 0]);
          if (jr.jointName === "left_knee") jr.quaternion = eulerToQuaternion([leftKneeAngle, 0, 0]);
          if (jr.jointName === "right_knee") jr.quaternion = eulerToQuaternion([rightKneeAngle, 0, 0]);
          if (jr.jointName === "left_shoulder") jr.quaternion = eulerToQuaternion([leftShoulderAngle, 0, 0]);
          if (jr.jointName === "right_shoulder") jr.quaternion = eulerToQuaternion([rightShoulderAngle, 0, 0]);
        }
      } else if (type === "wave") {
        const wavePhase = t * Math.PI * 4;
        const rightShoulderAngleZ = 135;
        const rightShoulderAngleY = Math.sin(wavePhase) * 30;
        
        for (const jr of jointRotations) {
          if (jr.jointName === "right_shoulder") {
            jr.quaternion = eulerToQuaternion([0, rightShoulderAngleY, rightShoulderAngleZ]);
          }
          if (jr.jointName === "right_elbow") {
            jr.quaternion = eulerToQuaternion([0, 0, 45]);
          }
        }
      } else if (type === "jump") {
        const jumpPhase = (t % 1.0) * Math.PI; // 1 second jump cycle
        rootTranslation[1] = Math.max(0, Math.sin(jumpPhase) * 0.5); // Y translation for jump height
        const kneeBend = Math.abs(Math.cos(jumpPhase)) * 45; // Bend knees at start/end
        
        for (const jr of jointRotations) {
          if (jr.jointName === "left_knee" || jr.jointName === "right_knee") {
            jr.quaternion = eulerToQuaternion([kneeBend, 0, 0]);
          }
          if (jr.jointName === "left_hip" || jr.jointName === "right_hip") {
            jr.quaternion = eulerToQuaternion([-kneeBend/2, 0, 0]);
          }
        }
      } else { // idle
        const breathPhase = t * Math.PI; // 2 seconds per breath
        const chestExpand = Math.sin(breathPhase) * 2; // small rotation on spine
        
        for (const jr of jointRotations) {
          if (jr.jointName === "spine2") {
            jr.quaternion = eulerToQuaternion([chestExpand, 0, 0]);
          }
          // Slight randomness to avoid stiffness
          if (jr.jointName === "head") {
             jr.quaternion = eulerToQuaternion([Math.sin(t*0.5)*2, Math.cos(t*0.3)*2, 0]);
          }
        }
      }

      frames.push({
        frameIndex: i,
        rootTranslation,
        jointRotations
      });
    }

    return {
      sequenceId: randomUUID(),
      prompt,
      fps,
      frameCount,
      durationMs: options.durationMs,
      skeleton: SMPLX_SKELETON,
      frames,
      metadata: { generatedBy: "mock", seed, type }
    };
  }

  async generateFromEmbedding(embedding: Float32Array, options: Generate3DOptions): Promise<MotionSequence3D> {
    return this.generate("embedded motion", options);
  }

  async listModels(): Promise<Motion3DModelInfo[]> {
    return [
      {
        id: "mock-model-v1",
        name: "Mock Procedural Model",
        backend: this.name,
        fileSize: 0,
        capabilities: ["text-to-motion"],
        license: "MIT"
      }
    ];
  }

  getCapabilities(): BackendCapabilities {
    return {
      supportsEmbedding: true,
      maxDurationMs: 60000,
      supportedSkeletons: ["smplx"],
      gpuRequired: false
    };
  }
}
