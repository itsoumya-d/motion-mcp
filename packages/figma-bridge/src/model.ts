import type { SceneArtboard, SceneDoc, SceneState, SceneTrack, SceneTransition } from "@motion-mcp/scene-graph";

/**
 * Plain-JSON snapshot produced by the figma-bridge plugin. The plugin only
 * COLLECTS (thin, Figma-API-specific); every synthesis decision lives in
 * snapshotToSceneDoc so it stays fully testable outside Figma.
 */
export interface FigmaSnapshot {
  version: 1;
  source: "figma-plugin";
  file?: string;
  frames: Array<FigmaFrameSnapshot>;
  connections: Array<FigmaConnectionSnapshot>;
}

export interface FigmaFrameSnapshot {
  id: string;
  name: string;
  width: number;
  height: number;
  background?: string;
  elements: Array<FigmaElementSnapshot>;
}

export interface FigmaElementSnapshot {
  id: string;
  name: string;
  kind: "rect" | "ellipse" | "vector" | "text" | "frame";
  /** Top-left corner within the frame. */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotationDeg?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  vectorPaths?: Array<{ windingRule: string; data: string }>;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
}

export type FigmaEasing =
  | "LINEAR"
  | "EASE_IN"
  | "EASE_OUT"
  | "EASE_IN_OUT"
  | "GENTLE"
  | "QUICK"
  | "BOUNCY"
  | "EASE_BACK"
  | "CUSTOM";

export type FigmaAnimationType =
  | "SMART_ANIMATE"
  | "DISSOLVE"
  | "MOVE_IN"
  | "MOVE_OUT"
  | "PUSH"
  | "APPEAR"
  | "INSTANT";

export interface FigmaConnectionSnapshot {
  fromFrameId: string;
  toFrameId: string;
  trigger: string;
  animationType: FigmaAnimationType | string;
  durationMs: number;
  easing: FigmaEasing | string;
}

// ---------------------------------------------------------------------------
// Snapshot → SceneDoc synthesis
// ---------------------------------------------------------------------------

/** Frames connected by reactions form one animated component cluster. */
export interface ClusterResult {
  artboards: SceneArtboard[];
  unclusteredFrames: string[];
}

const EASING_MAP: Record<string, "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring"> = {
  LINEAR: "linear",
  EASE_IN: "easeIn",
  EASE_OUT: "easeOut",
  EASE_IN_OUT: "easeInOut",
  GENTLE: "spring",
  QUICK: "easeOut",
  BOUNCY: "spring",
  EASE_BACK: "spring",
  CUSTOM: "easeInOut",
  INSTANT: "linear"
};

/** Figma prototype triggers → SceneDoc MotionEvents. */
const TRIGGER_MAP: Record<string, SceneTransition["event"]> = {
  ON_CLICK: "activate",
  ON_TAP: "activate",
  ON_HOVER: "pointerEnter",
  MOUSE_ENTER: "pointerEnter",
  MOUSE_LEAVE: "pointerLeave",
  ON_DRAG: "pressIn",
  AFTER_TIMEOUT: "reset",
  KEY_PRESS: "pressIn"
};

/**
 * Synthesizes SceneDoc artboards from a plugin snapshot:
 * - Connected frames become one artboard; each frame is a state whose clip
 *   holds its absolute pose (per-part translate/scale/opacity/rotate keys).
 *   Emitters interpolate between state variants — smart-animate for free.
 * - DISSOLVE collapses deltas to opacity-only crossfades; MOVE_IN slides
 *   the target in from off-canvas.
 * - Entry frame renders to a layered SVG so capture/preview work out of
 *   the box.
 */
export function snapshotToSceneDoc(snapshot: FigmaSnapshot): SceneDoc {
  const framesById = new Map(snapshot.frames.map((frame) => [frame.id, frame]));
  const clusters = clusterFrames(snapshot);

  const artboards: SceneArtboard[] = clusters.map((cluster) =>
    buildClusterArtboard(cluster, framesById, snapshot.connections)
  );

  return {
    formatVersion: 1,
    sceneId: `scene_figma_${stableHash(snapshot.file ?? "bridge")}`,
    name: snapshot.file ?? "Figma bridge import",
    createdAt: new Date().toISOString(),
    canvas: undefined,
    artboards
  };
}

function clusterFrames(snapshot: FigmaSnapshot): string[][] {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  const known = new Set(snapshot.frames.map((frame) => frame.id));
  for (const connection of snapshot.connections) {
    if (known.has(connection.fromFrameId) && known.has(connection.toFrameId)) {
      link(connection.fromFrameId, connection.toFrameId);
    }
  }

  const visited = new Set<string>();
  const clusters: string[][] = [];
  // Deterministic order: iterate frames in snapshot order.
  for (const frame of snapshot.frames) {
    if (visited.has(frame.id)) continue;
    const stack = [frame.id];
    const cluster: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

interface Pose {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotationDeg: number;
}

function posesFor(frame: FigmaFrameSnapshot): Map<string, Pose> {
  const poses = new Map<string, Pose>();
  for (const element of frame.elements) {
    poses.set(element.id, {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      opacity: element.opacity ?? 1,
      rotationDeg: element.rotationDeg ?? 0
    });
  }
  return poses;
}

function buildClusterArtboard(
  cluster: string[],
  framesById: Map<string, FigmaFrameSnapshot>,
  connections: FigmaConnectionSnapshot[]
): SceneArtboard {
  const orderedFrames = cluster
    .map((id) => framesById.get(id))
    .filter((frame): frame is FigmaFrameSnapshot => Boolean(frame));

  const entryFrame = orderedFrames[0]!;
  const allPartIds: string[] = [];
  const seenParts = new Set<string>();
  for (const frame of orderedFrames) {
    for (const element of frame.elements) {
      if (!seenParts.has(element.id)) {
        seenParts.add(element.id);
        allPartIds.push(element.id);
      }
    }
  }

  const basePoses = posesFor(entryFrame);
  const baseSize = (partId: string): { w: number; h: number } => {
    const pose = basePoses.get(partId);
    return { w: pose?.width || 1, h: pose?.height || 1 };
  };

  const statesAndClips = orderedFrames.map((frame) => {
    const poses = posesFor(frame);
    const tracks: SceneTrack[] = [];
    for (const partId of allPartIds) {
      const pose = poses.get(partId);
      const base = baseSize(partId);
      if (!pose) {
        // Element absent from this state → hidden.
        tracks.push({
          targetPart: partId,
          property: "opacity" as const,
          keys: [{ t: 0, value: 0, easing: "hold" as const }]
        });
        continue;
      }
      const push = (
        property: "translateX" | "translateY" | "scaleX" | "scaleY" | "opacity" | "rotate",
        value: number
      ) => tracks.push({ targetPart: partId, property, keys: [{ t: 0, value: round3(value), easing: "hold" as const }] });

      push("translateX", pose.x);
      push("translateY", pose.y);
      push("scaleX", pose.width / base.w);
      push("scaleY", pose.height / base.h);
      push("opacity", pose.opacity);
      if (pose.rotationDeg !== 0) push("rotate", pose.rotationDeg);
    }
    const clipId = `clip-${frame.id}`;
    const state: SceneState = {
      stateId: `state-${frame.id}`,
      name: slug(frame.name),
      kind: "single",
      clipId,
      loop: false,
      controlledParts: [...allPartIds]
    };
    return {
      frame,
      state,
      clip: {
        clipId,
        name: slug(frame.name),
        durationMs: 1,
        loop: false,
        tracks
      }
    };
  });

  const transitions: SceneTransition[] = [];
  const clusterSet = new Set(cluster);
  for (const connection of connections.filter(
    (candidate) => clusterSet.has(candidate.fromFrameId) && clusterSet.has(candidate.toFrameId)
  )) {
    const fromState = `state-${connection.fromFrameId}`;
    const toState = `state-${connection.toFrameId}`;
    const event: SceneTransition["event"] = TRIGGER_MAP[connection.trigger.toUpperCase()] ?? "activate";
    const interpolation = EASING_MAP[connection.easing.toUpperCase()] ?? "easeInOut";
    const durationMs = Math.max(0, Math.round(connection.durationMs));
    const animationType = connection.animationType.toUpperCase();

    transitions.push({
      transitionId: `t-${connection.fromFrameId}-${connection.toFrameId}`,
      fromStateId: fromState,
      toStateId: toState,
      event,
      durationMs: animationType === "INSTANT" ? 0 : Math.max(durationMs, 80),
      interpolation: interpolation as SceneTransition["interpolation"],
      conditions: [],
      actions: []
    });
  }

  const initialStateId = statesAndClips[0]!.state.stateId;

  return {
    artboardId: `figma_${entryFrame.id}`,
    name: entryFrame.name,
    sourceFile: undefined,
    layers: [
      {
        layerId: "figma-bridge-layer",
        name: "figma-bridge",
        order: 0,
        targetParts: [...allPartIds],
        initialStateId
      }
    ],
    clips: Object.fromEntries(statesAndClips.map((entry) => [entry.clip.clipId, entry.clip])),
    stateMachines: [
      {
        stateMachineId: `figma:${entryFrame.id}:machine`,
        name: "FigmaBridge",
        initialStateId,
        layerId: "figma-bridge-layer",
        states: statesAndClips.map((entry) => entry.state),
        transitions
      }
    ],
    bindings: [],
    listeners: [],
    audioEvents: [],
    semantics: { reducedMotionSafe: true }
  };
}

/**
 * Renders one frame's elements into a layered SVG with stable part ids so
 * the player/capture pipeline can play the entry state immediately.
 */
export function renderFrameToSvg(frame: FigmaFrameSnapshot): string {
  const body = frame.elements
    .map((element) => elementToSvg(element))
    .filter(Boolean)
    .join("\n  ");
  const backgroundAttr = frame.background ? `<rect width="${frame.width}" height="${frame.height}" fill="${frame.background}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.width} ${frame.height}" width="${frame.width}" height="${frame.height}">\n  ` +
    backgroundAttr +
    body +
    `\n</svg>`
  );
}

function elementToSvg(element: FigmaElementSnapshot): string {
  const opacity = element.opacity !== undefined && element.opacity < 1 ? ` opacity="${round3(element.opacity)}"` : "";
  const transform =
    element.rotationDeg ? ` transform="rotate(${round3(element.rotationDeg)} ${round3(element.x + element.width / 2)} ${round3(element.y + element.height / 2)})"` : "";
  const fill = element.fill ? ` fill="${element.fill}"` : "";
  const stroke = element.stroke ? ` stroke="${element.stroke}"${element.strokeWidth ? ` stroke-width="${round3(element.strokeWidth)}"` : ""}` : "";
  const common = ` id="${element.id}"${opacity}${fill}${stroke}${transform}`;

  switch (element.kind) {
    case "rect":
      return `<rect${common} x="${round3(element.x)}" y="${round3(element.y)}" width="${round3(element.width)}" height="${round3(element.height)}"${element.cornerRadius ? ` rx="${round3(Math.min(element.cornerRadius, element.width / 2, element.height / 2))}"` : ""}/>`;
    case "ellipse":
      return `<ellipse${common} cx="${round3(element.x + element.width / 2)}" cy="${round3(element.y + element.height / 2)}" rx="${round3(element.width / 2)}" ry="${round3(element.height / 2)}"/>`;
    case "text":
      return `<text${common} x="${round3(element.x)}" y="${round3(element.y + (element.fontSize ?? 16))}" font-size="${element.fontSize ?? 16}"${element.fontFamily ? ` font-family="${element.fontFamily}"` : ""}>${escapeXml(element.text ?? "")}</text>`;
    case "vector":
    case "frame": {
      const paths = (element.vectorPaths ?? [])
        .map((path) => `<path d="${path.data}"${path.windingRule === "NONZERO" ? "" : ` fill-rule="evenodd"`}/>`)
        .join("");
      if (!paths) return "";
      return `<g${common} transform="translate(${round3(element.x)} ${round3(element.y)})${transform ? "" : ""}">${paths}</g>`;
    }
    default:
      return "";
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) =>
    character === "<" ? "&lt;" :
    character === ">" ? "&gt;" :
    character === "&" ? "&amp;" :
    character === "'" ? "&apos;" : "&quot;"
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "state";
}

function stableHash(value: string): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).slice(0, 8);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
