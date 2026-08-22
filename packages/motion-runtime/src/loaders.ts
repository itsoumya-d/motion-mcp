import type { MotionClip, MotionClipMeta } from "./types.js";

export interface MotionDocJson {
  format?: string;
  version?: number;
  id?: string;
  fps?: number | null;
  durationMs: number;
  loop: boolean;
  meta?: Partial<MotionClipMeta> & Record<string, unknown>;
  tracks: Record<string, number[][]>;
  translations?: Record<string, number[][]>;
}

function toTrack(raw: number[][]): { keys: Array<{ t: number; x: number; y: number; z: number }>; ease: "smooth" } {
  const keys = raw.map((row) => ({ t: row[0]!, x: row[1]!, y: row[2]!, z: row[3]! }));
  for (const key of keys) {
    if (![key.t, key.x, key.y, key.z].every(Number.isFinite)) {
      throw new Error("MotionDoc track contains non-finite values");
    }
  }
  return { keys: keys.sort((a, b) => a.t - b.t), ease: "smooth" };
}

export function clipFromMotionDoc(doc: MotionDocJson): MotionClip {
  if (typeof doc.durationMs !== "number" || doc.durationMs <= 0) {
    throw new Error(`MotionDoc ${doc.id ?? "?"} has invalid durationMs`);
  }
  const tracks: MotionClip["tracks"] = {};
  for (const [joint, rows] of Object.entries(doc.tracks ?? {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    tracks[joint] = toTrack(rows);
  }
  if (Object.keys(tracks).length === 0) {
    throw new Error(`MotionDoc ${doc.id ?? "?"} has no usable rotation tracks`);
  }
  const translations: MotionClip["translations"] = {};
  for (const [joint, rows] of Object.entries(doc.translations ?? {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    translations[joint] = toTrack(rows);
  }
  return {
    id: doc.id ?? "baked-clip",
    durationMs: doc.durationMs,
    loop: Boolean(doc.loop),
    tracks,
    translations: Object.keys(translations).length > 0 ? translations : undefined,
    meta: { ...(doc.meta as MotionClipMeta | undefined), source: doc.meta?.source === "baked" ? "baked" : "baked", generator: doc.meta?.generator ?? "pipeline" }
  };
}
