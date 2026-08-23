import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reviewAnimation } from "../packages/mcp-server/src/review.ts";

const CROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <g id="tail"><path d="M60 150 L20 178 L64 168 Z" fill="#222"/></g>
  <g id="leg-left"><rect x="96" y="158" width="7" height="34" fill="#222"/></g>
  <g id="body"><ellipse cx="110" cy="118" rx="52" ry="42" fill="#333"/></g>
  <g id="wing-left"><path d="M74 96 Q40 104 46 132 Q66 140 88 124 Z" fill="#444"/></g>
  <g id="head"><circle cx="152" cy="62" r="26" fill="#333"/></g>
</svg>`;

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motion-review-"));
  const dot = path.join(root, ".motion-mcp");
  await fs.mkdir(dot, { recursive: true });
  await fs.writeFile(path.join(root, "crow.svg"), CROW_SVG, "utf8");
  const assets = {
    rootPath: root,
    assets: [{ id: "asset_crow", path: "crow.svg", type: "svg" }],
    indexPath: path.join(dot, "assets.json"),
    scannedAt: new Date().toISOString(),
    warnings: []
  };
  await fs.writeFile(path.join(dot, "assets.json"), JSON.stringify(assets), "utf8");
  return root;
}

test("review_animation runs end-to-end on an ingested asset via the ambient fallback", async () => {
  const root = await makeProject();
  try {
    // No research_state_machine_experience has run — the ambient fallback
    // scene must carry the review.
    const result = await reviewAnimation(root, {
      componentId: "asset_crow",
      maxFrames: 4
    });

    assert.equal(result.ok, true, result.checks.filter((c) => c.severity === "fail").map((c) => c.message).join("; "));
    assert.ok(result.score >= 85, `score ${result.score}`);
    assert.equal(result.componentId, "asset_crow");
    assert.equal(result.stateReviewed, "idle-breathe");
    assert.equal(result.nextTool, "apply_motion_diff");

    const persisted = JSON.parse(
      await fs.readFile(path.join(root, result.reportPath), "utf8")
    ) as { componentId: string; score: number; checks: unknown[] };
    assert.equal(persisted.componentId, "asset_crow");
    assert.ok(Array.isArray(persisted.checks));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("review_animation resolves components through staged diffs", async () => {
  const root = await makeProject();
  try {
    const dot = path.join(root, ".motion-mcp");
    const diff = {
      diffId: "diff_review_e2e",
      rootPath: root,
      componentId: "asset_crow",
      summary: "test",
      framework: "unknown",
      creditsConsumed: 0,
      validationStatus: { ok: true, skipped: true, reason: "" },
      files: [],
      unifiedDiff: "",
      createdAt: new Date().toISOString()
    };
    await fs.mkdir(path.join(dot, "diffs"), { recursive: true });
    await fs.writeFile(path.join(dot, "diffs", "diff_review_e2e.json"), JSON.stringify(diff), "utf8");

    const result = await reviewAnimation(root, { diffId: "diff_review_e2e", maxFrames: 4 });
    assert.equal(result.componentId, "asset_crow");
    assert.equal(result.ok, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("review_animation rejects unknown components with guidance", async () => {
  const root = await makeProject();
  try {
    await assert.rejects(
      () => reviewAnimation(root, { componentId: "asset_missing" }),
      /No indexed SVG asset/
    );
    await assert.rejects(
      () => reviewAnimation(root, {}),
      /requires diffId or componentId/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
