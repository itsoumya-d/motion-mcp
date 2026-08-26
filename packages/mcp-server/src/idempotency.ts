import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Request-level idempotency for side-effecting tools, following the design
 * shape of MCP SEP-3182 ("Request Idempotency",
 * https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3182):
 *
 * - A deterministic key is derived from the canonicalized tool arguments
 *   (sorted keys, test seams excluded), so a client retry of the same
 *   intended operation maps to the same key without the caller supplying one.
 * - The first execution records its result under `.motion-mcp/idempotency/`.
 * - A retry with the same key replays the recorded result instead of
 *   re-executing the pipeline (and re-staging artifacts / re-burning credits).
 *
 * Because the key is a hash of the arguments, the SEP's "same key with
 * different arguments" conflict case cannot occur by construction.
 */

export interface IdempotencyRecord<T> {
  key: string;
  at: string;
  result: T;
}

/** Stable JSON stringify: object keys sorted recursively, arrays preserved. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Deterministic request key for an ensoul_asset input (test seam excluded). */
export function ensoulRequestKey(input: Record<string, unknown>): string {
  const { _initialDoc: _omitted, ...rest } = input;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

function ledgerPath(root: string, key: string): string {
  return path.join(root, ".motion-mcp", "idempotency", `${key}.json`);
}

/** Returns the recorded result for this key, if a prior execution completed. */
export async function loadPriorResult<T>(root: string, key: string): Promise<T | undefined> {
  try {
    const record = JSON.parse(await fs.readFile(ledgerPath(root, key), "utf8")) as IdempotencyRecord<T>;
    return record.result;
  } catch {
    return undefined;
  }
}

/** Records a completed result so future retries of the same key replay it. */
export async function recordResult<T>(root: string, key: string, result: T): Promise<void> {
  const file = ledgerPath(root, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const record: IdempotencyRecord<T> = { key, at: new Date().toISOString(), result };
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
