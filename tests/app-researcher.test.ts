import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  estimateAssetLane,
  planScreenMotion,
  researchAppMotion
} from "../packages/app-researcher/src/index.ts";

test("app motion research builds screen context and ranked motion opportunities", async () => {
  const root = await makeNextFixture();
  try {
    const { context, motionMap } = await researchAppMotion({
      rootPath: root,
      brief: "Make dashboard loading and success states feel premium but restrained."
    });

    assert.equal(context.framework, "next");
    assert.ok(context.screens.some((screen) => screen.routePattern === "/"));
    assert.ok(context.flows.length >= 1);
    assert.ok(context.motionThesis.motionGrammar.some((item) => item.includes("success")));
    assert.ok(motionMap.opportunities.length >= 3);
    assert.ok(motionMap.opportunities[0]?.viewModel.properties.length);
    assert.ok(motionMap.opportunities[0]?.stateMachine.transitions.length);

    const persisted = JSON.parse(
      await readFile(path.join(root, ".motion-mcp", "app-context.json"), "utf8")
    ) as typeof context;
    assert.equal(persisted.contextId, context.contextId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("screen motion planning filters opportunities by screen", async () => {
  const root = await makeNextFixture();
  try {
    const { context } = await researchAppMotion({ rootPath: root });
    const screen = context.screens.find((candidate) => candidate.routePattern === "/") ?? context.screens[0];
    assert.ok(screen);

    const plan = await planScreenMotion({ rootPath: root, screenId: screen.screenId });

    assert.ok(plan.opportunities.length >= 1);
    assert.ok(plan.opportunities.every((opportunity) => opportunity.screenId === screen.screenId));
    assert.ok(plan.totalEstimatedCredits > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset lane selection separates simple host-model SVGs from premium Quiver assets", async () => {
  const root = await makeNextFixture();
  try {
    const { context } = await researchAppMotion({ rootPath: root });
    const screenId = context.screens[0]?.screenId;
    assert.ok(screenId);

    const simple = await estimateAssetLane({
      rootPath: root,
      screenId,
      assetBrief: "Small tab icon badge with a check mark"
    });
    const premium = await estimateAssetLane({
      rootPath: root,
      screenId,
      assetBrief: "Complex branded mascot illustration for onboarding hero reward moment"
    });

    assert.equal(simple.lane, "simple");
    assert.equal(premium.lane, "premium");
    assert.equal(premium.recommendedModel, "arrow-1.1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeNextFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "motion-mcp-app-researcher-"));
  await mkdir(path.join(root, "app", "settings"), { recursive: true });
  await mkdir(path.join(root, "public"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({
      dependencies: {
        next: "^15.1.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        "framer-motion": "^11.15.0"
      }
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "app", "page.tsx"),
    `export default function DashboardPage() {
  const progress = 0.7;
  return (
    <main>
      <svg viewBox="0 0 24 24" aria-label="brand mark">
        <path id="logo-mark" d="M12 2l9 20H3L12 2z" />
      </svg>
      <button>Generate motion</button>
      <p>Loading confidence {progress}</p>
      <p>Success confirmation</p>
    </main>
  );
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "app", "settings", "page.tsx"),
    `export default function SettingsPage() {
  return <main><button>Save billing settings</button></main>;
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "public", "logo.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g id="logo-mark"><path id="outer-shape" d="M16 2l14 28H2L16 2z" /></g>
  <circle id="spark-core" cx="22" cy="9" r="3" />
</svg>
`,
    "utf8"
  );
  return root;
}
