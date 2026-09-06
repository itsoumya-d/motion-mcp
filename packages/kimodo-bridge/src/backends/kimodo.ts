import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  Generate3DOptions,
  MotionSequence3D,
  Motion3DModelInfo,
  BackendCapabilities,
  KimodoConfig
} from "../types.js";
import type { Motion3DBackend } from "../backend-interface.js";
import { SMPLX_SKELETON } from "../types.js";

export class KimodoBackend implements Motion3DBackend {
  readonly name = "kimodo.cpp";
  readonly license = "MIT";

  private config: KimodoConfig;

  constructor(config: KimodoConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = spawn(this.config.binaryPath, ["--version"]);
      return new Promise((resolve) => {
        proc.on("close", (code) => {
          resolve(code === 0);
        });
        proc.on("error", () => {
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  async generate(prompt: string, options: Generate3DOptions): Promise<MotionSequence3D> {
    const fps = options.fps ?? 30;
    const durationMs = options.durationMs;
    const frameCount = Math.floor((durationMs / 1000) * fps);

    const args = [
      "-m", this.config.modelPath,
      "--prompt", prompt,
      "--duration", (durationMs / 1000).toString(),
      "--fps", fps.toString()
    ];

    if (this.config.device) args.push("--device", this.config.device);
    if (this.config.threads) args.push("--threads", this.config.threads.toString());
    if (options.seed !== undefined) args.push("--seed", options.seed.toString());
    if (options.steps) args.push("--steps", options.steps.toString());
    if (options.temperature) args.push("--temperature", options.temperature.toString());

    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.binaryPath, args);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Kimodo failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          // Assuming the output contains a 'frames' array matching our structure roughly
          resolve({
            sequenceId: randomUUID(),
            prompt,
            fps,
            frameCount,
            durationMs,
            skeleton: SMPLX_SKELETON,
            frames: parsed.frames || [], // In a real scenario, map this to SmplxFrame format
            metadata: { generatedBy: "kimodo", ...parsed.metadata }
          });
        } catch (e) {
          reject(new Error(`Failed to parse Kimodo output: ${e}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Kimodo process error: ${err.message}`));
      });
    });
  }

  async generateFromEmbedding(embedding: Float32Array, options: Generate3DOptions): Promise<MotionSequence3D> {
    throw new Error("generateFromEmbedding not currently supported by Kimodo backend");
  }

  async listModels(): Promise<Motion3DModelInfo[]> {
    return [
      {
        id: "kimodo-configured-model",
        name: this.config.modelPath.split('/').pop() || "unknown",
        backend: this.name,
        fileSize: 0,
        capabilities: ["text-to-motion"],
        license: "unknown"
      }
    ];
  }

  getCapabilities(): BackendCapabilities {
    return {
      supportsEmbedding: false,
      maxDurationMs: 30000,
      supportedSkeletons: ["smplx"],
      gpuRequired: false
    };
  }
}
