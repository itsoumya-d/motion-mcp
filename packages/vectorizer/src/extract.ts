import { spawn } from "node:child_process";
import { hasFfmpeg } from "@motion-mcp/capture";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ExtractOptions {
  fps?: number;
  /** Downscale frames to this width (height keeps aspect). */
  width?: number;
  hardCap?: number;
}

/**
 * Extracts PNG frames from a video via system ffmpeg on stdout
 * (`-f image2pipe`). No temp files; frame count is bounded by hardCap.
 */
export async function extractVideoFrames(videoPath: string, options: ExtractOptions = {}): Promise<Uint8Array[]> {
  if (!hasFfmpeg()) {
    throw new Error(
      "Video vectorization requires ffmpeg on PATH.\n" +
      "  macOS:   brew install ffmpeg\n" +
      "  Ubuntu:  apt install ffmpeg\n" +
      "Then re-run vectorize_video."
    );
  }
  const fps = Math.min(Math.max(Math.round(options.fps ?? 12), 1), 60);
  const hardCap = Math.min(Math.max(options.hardCap ?? 240, 1), 1200);
  const filter = options.width && options.width > 0
    ? `fps=${fps},scale=${Math.round(options.width)}:-2`
    : `fps=${fps}`;

  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-i", videoPath,
      "-vf", filter,
      "-frames:v", String(hardCap),
      "-f", "image2pipe",
      "-vcodec", "png",
      "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
        return;
      }
      const frames = splitPngStream(Buffer.concat(chunks));
      if (frames.length === 0) {
        reject(new Error(`ffmpeg produced no decodable PNG frames for ${videoPath}`));
        return;
      }
      resolve(frames);
    });
  });
}

/** Splits an image2pipe byte stream into individual PNG buffers. */
export function splitPngStream(buffer: Buffer): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let start = buffer.indexOf(PNG_SIGNATURE);
  while (start !== -1) {
    const next = buffer.indexOf(PNG_SIGNATURE, start + PNG_SIGNATURE.length);
    const end = next === -1 ? buffer.length : next;
    frames.push(new Uint8Array(buffer.subarray(start, end)));
    start = next;
  }
  return frames;
}
