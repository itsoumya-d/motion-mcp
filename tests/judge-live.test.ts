import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { decodePng, encodePng } from "../packages/capture/src/index.ts";
import {
  ClaudeVisionJudge,
  GeminiVisionJudge,
  MockJudgeProvider,
  resolveJudgeProvider
} from "../packages/critic/src/index.ts";
import type { DecodedFrameInput } from "../packages/critic/src/index.ts";

// ---------------------------------------------------------------------------
// encodePng roundtrip
// ---------------------------------------------------------------------------

test("encodePng produces a decodable byte-identical RGBA image", () => {
  const width = 12;
  const height = 9;
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = (pixel * 7) % 256;
    rgba[pixel * 4 + 1] = (pixel * 13) % 256;
    rgba[pixel * 4 + 2] = (pixel * 29) % 256;
    rgba[pixel * 4 + 3] = pixel % 2 ? 255 : 128;
  }
  const encoded = encodePng(width, height, rgba);
  const decoded = decodePng(encoded);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.deepEqual(decoded.rgba, rgba);
});

// ---------------------------------------------------------------------------
// Frame helpers + credential guards
// ---------------------------------------------------------------------------

function frames(count: number): DecodedFrameInput[] {
  const out: DecodedFrameInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const rgba = new Uint8Array(8 * 8 * 4).fill(200);
    rgba[index * 4] = 20;
    out.push({ rgba, width: 8, height: 8 });
  }
  return out;
}

function withoutKeys(run: () => Promise<void>): Promise<void> {
  const saved = {
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY
  };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  return run().finally(() => {
    if (saved.gemini !== undefined) process.env.GEMINI_API_KEY = saved.gemini;
    if (saved.google !== undefined) process.env.GOOGLE_API_KEY = saved.google;
    if (saved.anthropic !== undefined) process.env.ANTHROPIC_API_KEY = saved.anthropic;
  });
}

test("live judges fail with actionable messages when keys are absent", async () => {
  await withoutKeys(async () => {
    await assert.rejects(
      () => new GeminiVisionJudge().judge(frames(2), {}),
      /GEMINI_API_KEY/
    );
    await assert.rejects(
      () => new ClaudeVisionJudge().judge(frames(2), {}),
      /ANTHROPIC_API_KEY/
    );
  });
});

test("resolveJudgeProvider instantiates the configured provider", () => {
  assert.equal(resolveJudgeProvider({ provider: "mock", alivenessThreshold: 50, weight: 1 }).name, "mock");
  assert.equal(resolveJudgeProvider({ provider: "gemini", alivenessThreshold: 60, weight: 1 }).name, "gemini");
  assert.equal(resolveJudgeProvider({ provider: "claude", alivenessThreshold: 60, weight: 1 }).name, "claude");
  assert.ok(new MockJudgeProvider());
});

// ---------------------------------------------------------------------------
// Canned-server integration for both wire formats
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

async function withStubServer(
  handler: (req: CapturedRequest) => { status?: number; body: unknown },
  run: (port: number) => Promise<void>
): Promise<void> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const captured: CapturedRequest = {
        url: req.url ?? "",
        headers: req.headers,
        body: raw ? JSON.parse(raw) : {}
      };
      requests.push(captured);
      const outcome = handler(captured);
      res.writeHead(outcome.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(outcome.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const GEMINI_VERDICT = '{"alivenessScore": 82, "notes": ["fluid arc", "clear settle"], "verdict": "pass"}';

test("Gemini judge posts inline PNGs and normalizes the verdict", async () => {
  await withoutKeys(async () => {
    let captured: CapturedRequest | undefined;
    await withStubServer(
      (req) => {
        captured = req;
        return {
          body: { candidates: [{ content: { parts: [{ text: GEMINI_VERDICT }] } }] }
        };
      },
      async (port) => {
        const judge = new GeminiVisionJudge({
          apiKey: "test-key",
          endpoint: `http://127.0.0.1:${port}/v1beta/models/gemini-test:generateContent`,
          threshold: 55
        });
        const verdict = await judge.judge(frames(10), { prompt: "playful bounce", stateName: "bounce" });

        assert.equal(verdict.provider, "gemini");
        assert.equal(verdict.alivenessScore, 82);
        assert.equal(verdict.passes, true);
        assert.deepEqual(verdict.notes.slice(0, 2), ["fluid arc", "clear settle"]);

        assert.match(captured!.url, /\?key=test-key$/);
        const parts = captured!.body.contents[0].parts;
        const images = parts.filter((part: any) => part.inline_data);
        assert.ok(images.length <= 6, "frame downselection caps vision payload size");
        assert.equal(images[0].inline_data.mime_type, "image/png");
        assert.equal(parts[parts.length - 1].text.includes("playful bounce"), true);
        assert.equal(captured!.body.generationConfig.temperature, 0);
      }
    );
  });
});

test("Claude judge sends base64 images with required headers and honors the threshold", async () => {
  await withoutKeys(async () => {
    let captured: CapturedRequest | undefined;
    await withStubServer(
      (req) => {
        captured = req;
        return {
          body: {
            content: [{ type: "text", text: '{"alivenessScore":31,"notes":["static tail"],"verdict":"fail"}' }]
          }
        };
      },
      async (port) => {
        const judge = new ClaudeVisionJudge({
          apiKey: "sk-test",
          endpoint: `http://127.0.0.1:${port}/v1/messages`,
          threshold: 55
        });
        const verdict = await judge.judge(frames(4), { stateName: "idle" });

        assert.equal(verdict.provider, "claude");
        assert.equal(verdict.alivenessScore, 31);
        assert.equal(verdict.passes, false);

        assert.equal(captured!.headers["x-api-key"], "sk-test");
        assert.equal(captured!.headers["anthropic-version"], "2023-06-01");
        const messageContent = captured!.body.messages[0].content;
        const images = messageContent.filter((block: any) => block.type === "image");
        assert.equal(images.length, 4);
        assert.equal(images[0].source.media_type, "image/png");
        assert.equal(captured!.body.system.includes("motion-quality judge"), true);
      }
    );
  });
});

test("unparseable model output surfaces as a structured error", async () => {
  await withStubServer(
    () => ({
      body: { candidates: [{ content: { parts: [{ text: "It looks fine to me!" }] } }] }
    }),
    async (port) => {
      const judge = new GeminiVisionJudge({
        apiKey: "k",
        endpoint: `http://127.0.0.1:${port}/v1beta/models/gemini-test:generateContent`
      });
      await assert.rejects(() => judge.judge(frames(2), {}), /non-JSON/);
    }
  );
});
