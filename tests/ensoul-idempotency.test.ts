import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson, ensoulRequestKey } from "../packages/mcp-server/src/idempotency.ts";
import type { SceneDoc } from "../packages/scene-graph/src/index.ts";
import { ensoulAsset } from "../packages/mcp-server/src/ensoul.ts";

const CROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <g id="tail"><path d="M60 150 L20 178 L64 168 Z" fill="#222"/></g>
  <g id="body"><ellipse cx="110" cy="118" rx="52" ry="42" fill="#333"/></g>
  <g id="eye-left"><circle cx="146" cy="56" r="4.5" fill="#fff"/></g>
</svg>`;

async function makeRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

test("canonical keys: key order and test seams do not affect the request key", () => {
  const a = ensoulRequestKey({ svg: "<svg/>", prompt: "wave", temperament: "playful" });
  const b = ensoulRequestKey({ prompt: "wave", svg: "<svg/>", _initialDoc: {} as SceneDoc, temperament: "playful" });
  assert.equal(a, b, "reordered keys and the _initialDoc seam must not change the key");
  assert.equal(a, ensoulRequestKey(JSON.parse(canonicalJson({ svg: "<svg/>", prompt: "wave", temperament: "playful" }))));
  const other = ensoulRequestKey({ svg: "<svg/>", prompt: "pulse" });
  assert.notEqual(a, other, "different intended operations must get different keys");
});

test("retry with identical input replays the recorded result without re-executing", { timeout: 240000 }, async () => {
  const root = await makeRoot("ensoul-idem");
  const first = await ensoulAsset(root, { svg: CROW_SVG, prompt: "playful wave" });
  assert.equal(first.ok, true, JSON.stringify(first.stages, null, 2));
  assert.equal(first.replayed, undefined);

  // Simulates a lost-response retry: identical arguments, fresh call.
  const second = await ensoulAsset(root, { svg: CROW_SVG, prompt: "playful wave" });
  assert.equal(second.replayed, true);
  assert.equal(second.docPath, first.docPath, "retry must return the original staged artifact");
  assert.equal(second.ok, first.ok);
  assert.equal(
    JSON.stringify(second.stages),
    JSON.stringify(first.stages),
    "stage receipt is replayed verbatim"
  );
  assert.ok(second.notes.some((note) => note.startsWith("Idempotent replay of request")));

  // The ledger entry exists on disk under .motion-mcp/idempotency/.
  const ledgerDir = path.join(root, ".motion-mcp", "idempotency");
  const entries = await fs.readdir(ledgerDir);
  assert.equal(entries.length, 1, "one ledger record per distinct request");

  // A different intended operation gets its own key and executes for real.
  const third = await ensoulAsset(root, { svg: CROW_SVG, prompt: "gentle pulse" });
  assert.equal(third.replayed, undefined, "a different intended operation executes fresh");
  assert.notDeepEqual(third.stages, first.stages, "different prompt → different generation receipt");
  assert.equal((await fs.readdir(ledgerDir)).length, 2);
});
