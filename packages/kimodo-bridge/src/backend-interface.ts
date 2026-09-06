import type { 
  Generate3DOptions, 
  MotionSequence3D, 
  Motion3DModelInfo, 
  BackendCapabilities 
} from "./types.js";

export interface Motion3DBackend {
  readonly name: string;
  readonly license: string;
  isAvailable(): Promise<boolean>;
  generate(prompt: string, options: Generate3DOptions): Promise<MotionSequence3D>;
  generateFromEmbedding(embedding: Float32Array, options: Generate3DOptions): Promise<MotionSequence3D>;
  listModels(): Promise<Motion3DModelInfo[]>;
  getCapabilities(): BackendCapabilities;
}

export class BackendRegistry {
  private backends: Map<string, Motion3DBackend> = new Map();

  register(backend: Motion3DBackend): void {
    this.backends.set(backend.name, backend);
  }

  get(name: string): Motion3DBackend | undefined {
    return this.backends.get(name);
  }

  list(): string[] {
    return Array.from(this.backends.keys());
  }

  async getBestAvailable(): Promise<Motion3DBackend> {
    for (const backend of this.backends.values()) {
      if (await backend.isAvailable()) {
        return backend;
      }
    }
    throw new Error("No available backends found.");
  }
}
