import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureImport,
  insertComponentUsageAfterAnchor,
  rendersComponent
} from "../packages/ast-patcher/src/index.ts";

const PAGE = `"use client";

import * as React from "react";
import { Button } from "@/ui";

export default function Page() {
  return (
    <main>
      <Button>Buy</Button>
    </main>
  );
}
`;

test("ensureImport adds an import when none exists", () => {
  const result = ensureImport(PAGE, "../.motion-mcp/generated/react/MotionCtaMark", ["MotionCtaMark"]);
  assert.equal(result.changed, true);
  assert.ok(result.content.includes(`import { MotionCtaMark } from "../.motion-mcp/generated/react/MotionCtaMark";`));
  assert.ok(result.content.includes('import { Button } from "@/ui";'), "existing imports untouched");
});

test("ensureImport is idempotent and merges only missing symbols", () => {
  const once = ensureImport(PAGE, "@/ui", ["MotionCtaMark"]);
  assert.ok(once.content.includes('import { MotionCtaMark } from "@/ui";'));
  const twice = ensureImport(once.content, "@/ui", ["MotionCtaMark"]);
  assert.equal(twice.changed, false);
  assert.equal(twice.content, once.content);
  // partial coverage -> second import covers the missing symbol only
  const merged = ensureImport(PAGE, "@/ui", ["Button", "Stack"]);
  assert.ok(!merged.content.includes("{ Button, Stack }"));
  assert.ok(merged.content.includes('import { Stack } from "@/ui";'));
});

test("insertComponentUsageAfterAnchor renders once after the anchor line", () => {
  const withImport = ensureImport(PAGE, "../.motion-mcp/generated/react/MotionCtaMark", ["MotionCtaMark"]).content;
  const patched = insertComponentUsageAfterAnchor(withImport, "MotionCtaMark", "<Button>Buy</Button>");
  assert.equal(patched.changed, true);
  assert.ok(patched.content.includes("<Button>Buy</Button>\n      <MotionCtaMark  />"));
  const again = insertComponentUsageAfterAnchor(patched.content, "MotionCtaMark", "<Button>Buy</Button>");
  assert.equal(again.changed, false);
});

test("patcher refuses to guess without an anchor", () => {
  const result = insertComponentUsageAfterAnchor(PAGE, "MotionX", "nothing-matches-this");
  assert.equal(result.changed, false);
  assert.ok(result.notes[0]?.includes("anchor not found"));
});

test("rendersComponent detects existing usage variants", () => {
  assert.equal(rendersComponent(PAGE, "Button"), true);
  assert.equal(rendersComponent(PAGE, "MotionCtaMark"), false);
});
