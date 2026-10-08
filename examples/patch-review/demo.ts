import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ensureImport,
  insertComponentUsageAfterAnchor,
  type PatchResult
} from "../../packages/ast-patcher/src/index.ts";

const COMPONENT = "MotionCtaMark";
const SPECIFIER = "./MotionCtaMark";
const ANCHOR = "<PrimaryButton>Buy</PrimaryButton>";
const PROPS = 'aria-hidden="true"';

export function readFixture(name: "before" | "after"): string {
  return readFileSync(new URL(`./fixtures/${name}.tsx.txt`, import.meta.url), "utf8");
}

export interface DemoScenario {
  name: string;
  before: string;
  result: PatchResult;
}

/** Exercise the real patcher on an in-memory, hand-written fixture only. */
export function runPatchReviewDemo(): DemoScenario[] {
  const before = readFixture("before");
  const imported = ensureImport(before, SPECIFIER, [COMPONENT]);
  const inserted = insertComponentUsageAfterAnchor(imported.content, COMPONENT, ANCHOR, PROPS);
  const reimported = ensureImport(inserted.content, SPECIFIER, [COMPONENT]);
  const repeated = insertComponentUsageAfterAnchor(reimported.content, COMPONENT, ANCHOR, PROPS);

  return [
    { name: "Add a missing named import", before, result: imported },
    { name: "Insert after an explicit text anchor", before: imported.content, result: inserted },
    {
      name: "Repeat both operations: byte-identical no-op",
      before: inserted.content,
      result: {
        content: repeated.content,
        changed: reimported.changed || repeated.changed,
        notes: [...reimported.notes, ...repeated.notes]
      }
    },
    {
      name: "Missing anchor: leave the original source unchanged",
      before,
      result: insertComponentUsageAfterAnchor(before, COMPONENT, "<MissingAnchor />", PROPS)
    },
    {
      name: "Existing component text: conservative no-op (even inside a comment)",
      before: `${before}\n// Example: <${COMPONENT} />\n`,
      result: insertComponentUsageAfterAnchor(
        `${before}\n// Example: <${COMPONENT} />\n`, COMPONENT, ANCHOR, PROPS
      )
    }
  ];
}

export function formatDemo(scenarios: DemoScenario[]): string {
  const lines = [
    "Motion MCP: local patch-review demo",
    "Hand-written fixture; real existing patcher; no AI or external API calls.",
    "All changes stay in memory. No user project files are read or modified.",
    "",
    "=== BEFORE ===",
    scenarios[0]!.before.trimEnd(),
    "",
    "=== AFTER IMPORT + ANCHOR INSERTION ===",
    scenarios[1]!.result.content.trimEnd(),
    "",
    "=== REVIEW RECEIPT ==="
  ];
  for (const scenario of scenarios) {
    lines.push(`${scenario.result.changed ? "CHANGED" : "NO-OP"}: ${scenario.name}`);
    for (const note of scenario.result.notes) lines.push(`  ${note}`);
  }
  lines.push(
    "",
    "Scope: TypeScript syntax-tree import inspection + text-anchor JSX insertion.",
    "No semantic analysis, vulnerability detection, JSX AST rewrite, or compilation guarantee."
  );
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error("This demo accepts no arguments and only reads its bundled fixture.");
    process.exitCode = 1;
  } else {
    process.stdout.write(formatDemo(runPatchReviewDemo()));
  }
}
