export type ThreejsEmitTarget = "vanilla" | "r3f";

export interface ThreejsEmitOptions {
  target: ThreejsEmitTarget;
  useTypeScript?: boolean;
  useDrei?: boolean;
  componentName?: string;
  modelUrl?: string;
  includeControls?: boolean;
}

export interface EmittedThreejsFile {
  path: string;
  content: string;
  language: "tsx" | "ts" | "js";
}

export interface EmitterInput {
  planItem: any;
  asset?: any;
  options: ThreejsEmitOptions;
  scene?: any;
}
