import type { SceneArtboard, SceneDoc } from "@motion-mcp/scene-graph";
import { normalize, ScenePlayer } from "@motion-mcp/player";
import { applyFrame } from "@motion-mcp/player";
import type { GifFrameInput } from "./gif.js";
import { encodeGif } from "./gif.js";
import { decodePng } from "./png.js";

export interface CaptureSceneOptions {
  artboardId?: string;
  /** Which state's clip to render. Defaults to the machine's initial state. */
  state?: string;
  fps?: number;
  maxFrames?: number;
  width?: number;
}

export interface CaptureResult {
  gif: Uint8Array;
  frames: number;
  width: number;
  height: number;
  durationMs: number;
}

export interface FramePng {
  /** PNG-encoded raster of this frame. */
  png: Uint8Array;
  tMs: number;
}

export interface FramesResult {
  frames: FramePng[];
  width: number;
  height: number;
  durationMs: number;
  fps: number;
}

/**
 * Renders a SceneClip into PNG-encoded frames using the player's
 * deterministic seek — no browser. Shared by GIF capture, video assembly,
 * and preview snapshots.
 */
export async function renderSceneFrames(
  doc: SceneDoc,
  options: CaptureSceneOptions = {}
): Promise<FramesResult> {
  const Resvg = await loadResvg();

  const index = options.artboardId
    ? doc.artboards.findIndex((artboard) => artboard.artboardId === options.artboardId)
    : 0;
  const artboard: SceneArtboard | undefined = doc.artboards[index];
  if (!artboard) throw new Error(`artboard ${options.artboardId ?? "(first)"} not found`);
  const source = (artboard as { sourceSvg?: string }).sourceSvg;
  if (!source) {
    throw new Error(`artboard ${artboard.artboardId} has no sourceSvg attached`);
  }

  const machine = artboard.stateMachines[0];
  if (!machine) throw new Error(`artboard ${artboard.artboardId} has no state machines`);
  const stateName = options.state
    ? normalize(options.state)
    : normalize(machine.states.find((state) => state.stateId === machine.initialStateId)?.name ?? "idle");
  const stateNode = machine.states.find((state) => normalize(state.name) === stateName);
  const clip = stateNode?.clipId ? artboard.clips[stateNode.clipId] : undefined;
  if (!clip) throw new Error(`state "${stateName}" has no compiled clip`);

  const fps = Math.min(Math.max(options.fps ?? 20, 1), 60);
  const maxFrames = options.maxFrames ?? 120;
  const frameCount = Math.max(1, Math.min(Math.round((clip.durationMs / 1000) * fps), maxFrames));
  const targetWidth = options.width ?? naturalWidth(source);

  const player = new ScenePlayer(doc, { artboardId: artboard.artboardId });
  try {
    player.enterState(stateName);
  } catch {
    // fall back to initial state
  }

  const frames: FramePng[] = [];
  let width = targetWidth;
  let height = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let t = (frameIndex / fps) * 1000;
    if (clip.loop && clip.durationMs > 0) t %= clip.durationMs;
    const frameSvg = applyFrame(source, player.sampleAt(stateName, t));
    const renderer = new Resvg(frameSvg, {
      fitTo: { mode: "width", value: targetWidth }
    });
    const pngBytes = renderer.render().asPng();
    const decoded = decodePng(new Uint8Array(pngBytes));
    width = decoded.width;
    height = decoded.height;
    frames.push({ png: new Uint8Array(pngBytes), tMs: t });
  }

  return { frames, width, height, durationMs: clip.durationMs, fps };
}

/**
 * Renders a SceneClip to an animated GIF without a browser.
 * Frames come from {@link renderSceneFrames}; assembly is pure TS.
 */
export async function captureSceneGif(doc: SceneDoc, options: CaptureSceneOptions = {}): Promise<CaptureResult> {
  const { frames, width, height, durationMs, fps } = await renderSceneFrames(doc, options);
  const gifFrames: GifFrameInput[] = frames.map((frame) => {
    const decoded = decodePng(frame.png);
    return { rgba: decoded.rgba, width: decoded.width, height: decoded.height, delayMs: 1000 / fps };
  });
  if (gifFrames.length === 0) throw new Error("renderSceneFrames produced no frames");
  return { gif: encodeGif(gifFrames), frames: gifFrames.length, width, height, durationMs };
}

async function loadResvg(): Promise<typeof import("@resvg/resvg-js").Resvg> {
  try {
    const module = await import("@resvg/resvg-js");
    return module.Resvg;
  } catch {
    throw new Error(
      "SVG rasterization requires @resvg/resvg-js. Install it in your workspace:\n" +
      "  pnpm add @resvg/resvg-js\n" +
      "Then re-run capture."
    );
  }
}

function naturalWidth(sourceSvg: string): number {
  const match = sourceSvg.match(/width\s*=\s*"(\d+(?:\.\d+)?)"/i)
    ?? sourceSvg.match(/viewBox\s*=\s*"[^"]*\s(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  const value = Number.parseFloat(match?.[1] ?? "512");
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 512;
}
