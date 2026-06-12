import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  autoResearchMotion,
  normalizeResearchSource,
  rankResearchOpportunities
} from "../packages/auto-researcher/src/index.ts";
import type { AutoResearchMotionResult, MotionResearchOpportunity } from "../packages/shared-types/src/index.ts";

test("source normalization and opportunity ranking are deterministic and source-backed", () => {
  const source = normalizeResearchSource({
    title: "  Motion React Gestures  ",
    url: " https://motion.dev/docs/react-gestures ",
    kind: "official-doc",
    platforms: ["React", "Next.js"],
    topics: ["Gesture Animation", "SVG"],
    summary: "Gesture animation docs.",
    confidence: 130
  });

  assert.equal(source.title, "Motion React Gestures");
  assert.equal(source.url, "https://motion.dev/docs/react-gestures");
  assert.deepEqual(source.platforms, ["react", "next-js"]);
  assert.deepEqual(source.topics, ["gesture-animation", "svg"]);
  assert.equal(source.confidence, 100);

  const low = makeOpportunity("low", 40);
  const high = makeOpportunity("high", 90);
  const ranked = rankResearchOpportunities([low, high]);

  assert.equal(ranked[0]?.opportunityId, "high");
  assert.ok((ranked[0]?.score.total ?? 0) > (ranked[1]?.score.total ?? 0));
  assert.ok(ranked[0]?.sourceIds.includes("rive-state-machine"));
});

test("auto research writes source-backed findings, ranked opportunities, and context packs", async () => {
  const root = await makeFixture();
  try {
    const result = await autoResearchMotion({
      rootPath: root,
      brief: "Make this app best-in-category with source-backed Rive-like motion.",
      includeSources: [
        {
          title: "Local motion system memo",
          url: "https://example.com/motion-system",
          kind: "article",
          platforms: ["next"],
          topics: ["motion-system"],
          summary: "Internal memo used as an extra source for the host agent.",
          confidence: 74
        }
      ]
    });

    assert.ok(result.sources.some((source) => source.sourceId === "rive-state-machine"));
    assert.ok(result.sources.some((source) => source.url === "https://example.com/motion-system"));
    assert.ok(result.findings.length >= 5);
    assert.ok(result.findings.every((finding) => finding.sourceIds.length > 0));
    assert.ok(result.opportunities.length >= 3);
    assert.ok(result.opportunities.every((opportunity) => opportunity.sourceIds.length > 0));
    assert.ok(result.opportunities.every((opportunity) => opportunity.localEvidence.length > 0));
    assert.ok(result.opportunities[0]?.score.total >= result.opportunities.at(-1)!.score.total);
    assert.ok(result.contextPacks.length >= 1);
    assert.ok(result.contextPacks[0]?.selectedFiles.length);
    assert.ok(result.contextPacks[0]?.constraints.some((constraint) => /reduced-motion/i.test(constraint)));
    assert.ok(result.summary.stableTargets.includes("next"));

    const persisted = JSON.parse(
      await readFile(path.join(root, ".motion-mcp", "auto-research.json"), "utf8")
    ) as AutoResearchMotionResult;
    assert.equal(persisted.researchId, result.researchId);
    assert.equal(persisted.contextPacks[0]?.contextPackId, result.contextPacks[0]?.contextPackId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP bridge exposes auto_research_motion as a local MCP smoke path", async () => {
  const root = await makeFixture();
  const port = await getFreePort();
  const child = spawnServer(port);
  try {
    await waitForBridge(port);
    const response = await fetch(`http://127.0.0.1:${port}/tool/auto_research_motion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rootPath: root,
        brief: "HTTP smoke test for source-backed motion research."
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as AutoResearchMotionResult;
    assert.ok(payload.sources.some((source) => source.sourceId === "langchain-context-engineering"));
    assert.ok(payload.opportunities.length >= 1);
    assert.ok(payload.contextPacks.length >= 1);
  } finally {
    child.stdin.end();
    child.kill();
    await onceExit(child);
    await rm(root, { recursive: true, force: true });
  }
});

function makeOpportunity(opportunityId: string, base: number): MotionResearchOpportunity {
  return {
    opportunityId,
    title: opportunityId,
    summary: `${opportunityId} opportunity`,
    category: "web-motion",
    targetPlatform: "Next.js",
    framework: "next",
    file: "app/page.tsx",
    sourceIds: ["rive-state-machine", "motion-react"],
    localEvidence: ["fixture evidence"],
    score: {
      impact: base,
      sourceSupport: base,
      localFit: base,
      effort: base,
      verificationStrength: base,
      safety: base,
      total: 0
    },
    recommendedToolSequence: ["auto_research_motion"],
    verificationCommands: ["node --test"],
    constraints: ["respect reduced-motion"]
  };
}

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "motion-mcp-auto-research-"));
  await mkdir(path.join(root, "app", "settings"), { recursive: true });
  await mkdir(path.join(root, "examples", "expo-app", "app"), { recursive: true });
  await writeJson(path.join(root, "package.json"), {
    dependencies: {
      next: "^15.1.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "framer-motion": "^11.15.0"
    },
    devDependencies: {
      typescript: "^5.7.2"
    }
  });
  await writeJson(path.join(root, "examples", "expo-app", "package.json"), {
    dependencies: {
      expo: "^52.0.0",
      "react-native": "^0.76.0",
      "react-native-svg": "^15.8.0",
      "react-native-reanimated": "^3.16.0"
    }
  });
  await writeFile(
    path.join(root, "app", "page.tsx"),
    `export default function HomePage() {
  return (
    <main>
      <svg viewBox="0 0 32 32" aria-label="Motion mark">
        <g id="logo-mark"><path id="bolt-core" d="M16 2l12 28H4L16 2z" /></g>
        <circle id="spark-core" cx="24" cy="8" r="3" />
      </svg>
      <button>Generate premium motion</button>
      <p>Loading confidence and success confirmation</p>
    </main>
  );
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "app", "settings", "page.tsx"),
    `export default function SettingsPage() {
  return <main><button>Save billing settings</button><p>Error recovery</p></main>;
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "examples", "expo-app", "app", "index.tsx"),
    `import { Pressable, Text, View } from "react-native";
export default function StreakScreen() {
  return <View><Text>Daily Streak</Text><Text>17</Text><Pressable><Text>Heart</Text></Pressable></View>;
}
`,
    "utf8"
  );
  return root;
}

async function writeJson(file: string, payload: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function spawnServer(port: number): ChildProcessWithoutNullStreams {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "packages/mcp-server/src/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MOTION_MCP_HTTP_PORT: String(port),
        MOTION_MCP_INITIAL_CREDITS: "5000"
      },
      stdio: "pipe"
    }
  );
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function waitForBridge(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/tool/get_credit_balance`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`HTTP bridge did not start on port ${port}.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a local port."));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function onceExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => resolve(), 2000).unref();
  });
}
