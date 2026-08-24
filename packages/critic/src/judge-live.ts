import { encodePng } from "@motion-mcp/capture";
import type { DecodedFrameInput, JudgeContext, JudgeProvider, JudgeVerdict } from "./judge.js";

const SYSTEM_INSTRUCTION = [
  "You are a strict motion-quality judge for UI/character animation.",
  "You receive consecutive frames sampled (in playback order) from a headless render of one animation state.",
  "Score how ALIVE and INTENTIONAL the motion reads, 0-100:",
  "  - presence: do adjacent frames actually differ in meaningful ways",
  "  - smoothness: would the implied motion be fluid rather than popping",
  "  - intent match: does the motion plausibly express the stated prompt/state",
  "Be calibrated: a static or near-static render must score below 40; fluid expressive motion above 70.",
  'Respond ONLY with minified JSON of shape {"alivenessScore": <integer 0-100>, "notes": ["short findings"], "verdict": "pass"|"fail"}.'
].join("\n");

interface JudgeLlmOptions {
  apiKey?: string;
  model?: string;
  /** Overrides the API endpoint (tests point this at a local stub server). */
  endpoint?: string;
  threshold?: number;
}

/** Frames are downselected so vision calls stay cheap and focused. */
function selectFrames(frames: DecodedFrameInput[], max = 6): DecodedFrameInput[] {
  if (frames.length <= max) return frames;
  const stride = (frames.length - 1) / (max - 1);
  const out: DecodedFrameInput[] = [];
  for (let slot = 0; slot < max; slot += 1) {
    out.push(frames[Math.round(slot * stride)]!);
  }
  return out;
}

function buildUserPrompt(context: JudgeContext, frameCount: number): string {
  return [
    `Frames provided: ${frameCount} (playback order).`,
    context.stateName ? `Animation state: ${context.stateName}.` : "",
    context.prompt ? `Original creative intent: ${context.prompt}.` : "No explicit intent was given.",
    "Judge the motion now. JSON only."
  ]
    .filter(Boolean)
    .join(" ");
}

function verdictFromModel(
  provider: string,
  raw: string,
  threshold: number
): JudgeVerdict {
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    throw new Error(`Vision judge returned non-JSON output: ${raw.slice(0, 200)}`);
  }
  let parsed: { alivenessScore?: unknown; notes?: unknown };
  try {
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch (error) {
    throw new Error(`Vision judge JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.alivenessScore ?? 0))));
  if (!Number.isFinite(score)) {
    throw new Error(`Vision judge returned an unusable alivenessScore: ${String(parsed.alivenessScore)}`);
  }
  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.map((note) => String(note)).slice(0, 8)
    : [String(parsed.notes ?? "")].filter(Boolean);
  return {
    provider,
    alivenessScore: score,
    notes,
    passes: score >= threshold
  };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const GEMINI_DEFAULT_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

export class GeminiVisionJudge implements JudgeProvider {
  readonly name = "gemini";

  constructor(private readonly options: JudgeLlmOptions = {}) {}

  private apiKey(): string {
    const key = this.options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new Error(
        'Gemini vision judge needs GEMINI_API_KEY (or GOOGLE_API_KEY). Until then keep rubric.judge.provider="mock".'
      );
    }
    return key;
  }

  async judge(frames: DecodedFrameInput[], context: JudgeContext): Promise<JudgeVerdict> {
    const apiKey = this.apiKey();
    const model = this.options.model ?? process.env.MOTION_MCP_GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
    const selected = selectFrames(frames);
    const threshold = this.options.threshold ?? 55;

    const parts: Array<Record<string, unknown>> = selected.map((frame) => ({
      inline_data: {
        mime_type: "image/png",
        data: Buffer.from(encodePng(frame.width, frame.height, frame.rgba)).toString("base64")
      }
    }));
    parts.push({ text: buildUserPrompt(context, selected.length) });

    const endpoint =
      this.options.endpoint ?? `${GEMINI_DEFAULT_ENDPOINT}/${model}:generateContent`;
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) {
      throw new Error(`Gemini judge HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return verdictFromModel(this.name, text, threshold);
  }
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const CLAUDE_DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-5";

export class ClaudeVisionJudge implements JudgeProvider {
  readonly name = "claude";

  constructor(private readonly options: JudgeLlmOptions = {}) {}

  private apiKey(): string {
    const key = this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        'Claude vision judge needs ANTHROPIC_API_KEY. Until then keep rubric.judge.provider="mock".'
      );
    }
    return key;
  }

  async judge(frames: DecodedFrameInput[], context: JudgeContext): Promise<JudgeVerdict> {
    const apiKey = this.apiKey();
    const model = this.options.model ?? process.env.MOTION_MCP_CLAUDE_MODEL ?? CLAUDE_DEFAULT_MODEL;
    const selected = selectFrames(frames);
    const threshold = this.options.threshold ?? 55;

    const content: Array<Record<string, unknown>> = selected.map((frame) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: Buffer.from(encodePng(frame.width, frame.height, frame.rgba)).toString("base64")
      }
    }));
    content.push({ type: "text", text: buildUserPrompt(context, selected.length) });

    const response = await fetch(this.options.endpoint ?? CLAUDE_DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature: 0,
        system: SYSTEM_INSTRUCTION,
        messages: [{ role: "user", content }]
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) {
      throw new Error(`Claude judge HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = payload.content?.map((block) => block.text ?? "").join("") ?? "";
    return verdictFromModel(this.name, text, threshold);
  }
}
