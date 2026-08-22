import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type VideoFormat = "mp4" | "webm";

export interface AssembleVideoOptions {
  /** PNG-encoded frames, in playback order. */
  frames: Uint8Array[];
  fps: number;
  format?: VideoFormat;
}

let ffmpegAvailable: boolean | undefined;

/** True when an ffmpeg binary is on PATH. Result is cached. */
export function hasFfmpeg(): boolean {
  if (ffmpegAvailable !== undefined) return ffmpegAvailable;
  try {
    const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    ffmpegAvailable = probe.status === 0;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/**
 * Assembles PNG frames into MP4 (H.264) or WebM (VP9) via the system
 * ffmpeg. Frames are staged in a temp dir; the binary is invoked with
 * deterministic flags so identical input yields equivalent output.
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<Uint8Array> {
  const format = options.format ?? "mp4";
  if (!hasFfmpeg()) {
    throw new Error(
      "Video assembly requires ffmpeg on PATH.\n" +
      "  macOS:   brew install ffmpeg\n" +
      "  Ubuntu:  apt install ffmpeg\n" +
      "Then re-run capture."
    );
  }
  if (options.frames.length === 0) throw new Error("assembleVideo needs at least one frame");

  const dir = await mkdtemp(path.join(tmpdir(), "motion-mcp-video-"));
  try {
    const padWidth = String(options.frames.length - 1).length + 1;
    for (let index = 0; index < options.frames.length; index += 1) {
      const name = `frame-${String(index).padStart(padWidth, "0")}.png`;
      await writeFile(path.join(dir, name), options.frames[index]!);
    }

    const outputName = format === "webm" ? "out.webm" : "out.mp4";
    const args = [
      "-y",
      "-loglevel", "error",
      "-framerate", String(options.fps),
      "-start_number", "0",
      "-i", path.join(dir, `frame-%0${padWidth}d.png`)
    ];
    if (format === "webm") {
      // resvg PNGs arrive as RGBA; VP9 needs an explicit yuv target.
      args.push("-pix_fmt", "yuv420p", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-deadline", "realtime", "-cpu-used", "8");
    } else {
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    }
    args.push(path.join(dir, outputName));

    const stderrTail = await runFfmpeg(args);
    const bytes = await readFile(path.join(dir, outputName));
    if (bytes.length === 0) {
      throw new Error(`ffmpeg produced no output: ${stderrTail.slice(-400)}`);
    }
    return new Uint8Array(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}
