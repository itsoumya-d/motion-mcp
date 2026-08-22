import {
  type SvgModelId,
  type SvgModelInfo,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";

export interface QuiverProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  mock?: boolean;
}

export interface GenerateSvgInput {
  prompt: string;
  instructions?: string;
  references?: string[];
  model?: SvgModelId;
  n?: number;
}

export interface VectorizeAssetInput {
  imageBase64: string;
  mimeType: string;
  instructions?: string;
  model?: SvgModelId;
}

export interface QuiverSvgResult {
  svg: string;
  model: SvgModelId;
  pricingCredits: number;
  requestId?: string;
  traceId?: string;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    reset?: string;
  };
}

const DEFAULT_BASE_URL = "https://api.quiver.ai/v1";
const DEFAULT_MODEL: SvgModelId = "arrow-1.1";
const MAX_MODEL: SvgModelId = "arrow-1.1-max";
// Pricing verified against GET /v1/models on the live QuiverAI API.
const FALLBACK_MODELS: SvgModelInfo[] = [
  {
    id: DEFAULT_MODEL,
    name: "Arrow 1.1",
    pricingCredits: 20,
    available: true,
    default: true
  },
  {
    id: MAX_MODEL,
    name: "Arrow 1.1 Max",
    pricingCredits: 25,
    available: true,
    maxQuality: true
  },
  {
    id: "arrow-1" as SvgModelId,
    name: "Arrow 1.0",
    pricingCredits: 30,
    available: true
  }
];

/** Keys that should be rotated away from after auth/payment/rate-limit failures. */
const KEY_FAILURE_STATUSES = new Set([401, 402, 429]);
const MAX_ATTEMPTS_PER_KEY = 2;
const MAX_BACKOFF_MS = 8_000;

export function parseApiKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function backoffDelayMs(attempt: number, rateLimitResetHeader?: string | null): number {
  const reset = parseRateLimitReset(rateLimitResetHeader);
  if (reset !== undefined) {
    return Math.min(Math.max(reset, 250), MAX_BACKOFF_MS);
  }
  return Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
}

function parseRateLimitReset(header?: string | null): number | undefined {
  if (!header) return undefined;
  const asSeconds = Number.parseInt(header, 10);
  if (Number.isFinite(asSeconds)) return asSeconds * 1000;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return asDate - Date.now();
  return undefined;
}

export function selectSvgModel(input: {
  requested?: SvgModelId;
  prompt?: string;
  instructions?: string;
}): SvgModelId {
  if (input.requested) return input.requested;
  const text = `${input.prompt ?? ""} ${input.instructions ?? ""}`.toLowerCase();
  if (/dense|technical|diagram|high[- ]?fidelity|detailed|max/.test(text)) {
    return MAX_MODEL;
  }
  return DEFAULT_MODEL;
}

export function motionCreditsForQuiver(pricingCredits: number, marginMultiplier = 2): number {
  return Math.max(1, Math.ceil(pricingCredits * marginMultiplier));
}

export class QuiverProvider {
  private readonly apiKeys: string[];
  private keyIndex = 0;
  private readonly baseUrl: string;
  private readonly mock: boolean;

  constructor(options: QuiverProviderOptions = {}) {
    this.apiKeys = options.apiKey
      ? [options.apiKey]
      : parseApiKeys(process.env.QUIVERAI_API_KEYS).length
        ? parseApiKeys(process.env.QUIVERAI_API_KEYS)
        : parseApiKeys(process.env.QUIVERAI_API_KEY);
    this.baseUrl = options.baseUrl ?? process.env.QUIVERAI_BASE_URL ?? DEFAULT_BASE_URL;
    this.mock = options.mock ?? (process.env.MOTION_MCP_QUIVER_MOCK === "1" || !this.apiKeys.length);
  }

  /** Number of live keys available for rotation. */
  get keyCount(): number {
    return this.apiKeys.length;
  }

  private rotateKey(): void {
    if (this.apiKeys.length > 1) {
      this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    }
  }

  async listModels(): Promise<SvgModelInfo[]> {
    if (this.mock || !this.apiKeys.length) {
      return FALLBACK_MODELS;
    }
    const response = await this.request("GET", "/models");
    const payload = await response.json() as unknown;
    return normalizeModels(payload);
  }

  async getModel(model: SvgModelId): Promise<SvgModelInfo> {
    const models = await this.listModels();
    return models.find((candidate) => candidate.id === model) ?? fallbackModel(model);
  }

  async generateSvg(input: GenerateSvgInput): Promise<QuiverSvgResult> {
    const model = selectSvgModel({
      requested: input.model,
      prompt: input.prompt,
      instructions: input.instructions
    });
    const modelInfo = await this.getModel(model);
    if (this.mock || !this.apiKeys.length) {
      return {
        svg: mockSvg(input.prompt, input.instructions),
        model,
        pricingCredits: modelInfo.pricingCredits,
        requestId: stableId("mock_req", `${input.prompt}:${nowIso()}`),
        traceId: "mock-quiver"
      };
    }
    const response = await this.request("POST", "/svgs/generations", {
      model,
      prompt: input.prompt,
      instructions: input.instructions,
      references: input.references,
      n: input.n ?? 1
    });
    const payload = await response.json() as unknown;
    return {
      svg: extractSvg(payload),
      model,
      pricingCredits: modelInfo.pricingCredits,
      requestId: response.headers.get("x-request-id") ?? undefined,
      traceId: response.headers.get("x-trace-id") ?? undefined,
      rateLimit: rateLimitFromHeaders(response.headers)
    };
  }

  async vectorizeAsset(input: VectorizeAssetInput): Promise<QuiverSvgResult> {
    const model = selectSvgModel({
      requested: input.model,
      instructions: input.instructions
    });
    const modelInfo = await this.getModel(model);
    if (this.mock || !this.apiKeys.length) {
      return {
        svg: mockSvg("Vectorized app asset", input.instructions),
        model,
        pricingCredits: modelInfo.pricingCredits,
        requestId: stableId("mock_vec", `${input.instructions ?? ""}:${nowIso()}`),
        traceId: "mock-quiver"
      };
    }
    const response = await this.request("POST", "/svgs/vectorizations", {
      model,
      image: input.imageBase64,
      mime_type: input.mimeType,
      instructions: input.instructions
    });
    const payload = await response.json() as unknown;
    return {
      svg: extractSvg(payload),
      model,
      pricingCredits: modelInfo.pricingCredits,
      requestId: response.headers.get("x-request-id") ?? undefined,
      traceId: response.headers.get("x-trace-id") ?? undefined,
      rateLimit: rateLimitFromHeaders(response.headers)
    };
  }

  /**
   * Sends a request, retrying with exponential backoff on 429/5xx and
   * rotating across QUIVERAI_API_KEYS when a key hits auth (401),
   * insufficient credits (402), or rate limits (429).
   */
  private async request(method: "GET" | "POST", pathname: string, body?: unknown): Promise<Response> {
    if (!this.apiKeys.length) {
      throw new Error("QUIVERAI_API_KEY or QUIVERAI_API_KEYS is required for real QuiverAI requests. Set MOTION_MCP_QUIVER_MOCK=1 for local mock mode.");
    }
    let lastError: Error | null = null;
    for (let keyVisit = 0; keyVisit < this.apiKeys.length; keyVisit += 1) {
      const apiKey = this.apiKeys[this.keyIndex];
      let attempt = 0;
      while (attempt < MAX_ATTEMPTS_PER_KEY) {
        let response: Response;
        try {
          response = await fetch(`${this.baseUrl}${pathname}`, {
            method,
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json"
            },
            body: body ? JSON.stringify(body) : undefined
          });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          attempt += 1;
          if (attempt < MAX_ATTEMPTS_PER_KEY) {
            await sleep(backoffDelayMs(attempt));
            continue;
          }
          break;
        }
        if (response.ok) {
          return response;
        }
        lastError = await quiverError(response);
        if (response.status === 429 || response.status >= 500) {
          attempt += 1;
          if (attempt < MAX_ATTEMPTS_PER_KEY) {
            await sleep(backoffDelayMs(attempt - 1, response.headers.get("x-ratelimit-reset")));
            continue;
          }
        }
        break;
      }
      const failureStatus = statusFromError(lastError);
      if (KEY_FAILURE_STATUSES.has(failureStatus)) {
        this.rotateKey();
        continue;
      }
      throw lastError ?? new Error("QuiverAI request failed.");
    }
    throw lastError ?? new Error("QuiverAI request failed after trying all API keys.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusFromError(error: Error | null): number {
  const match = /\((\d{3})\)/.exec(error?.message ?? "");
  return match ? Number.parseInt(match[1], 10) : 0;
}

function normalizeModels(payload: unknown): SvgModelInfo[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown[] })?.models)
        ? (payload as { models: unknown[] }).models
        : [];
  const normalized = list
    .map((item): SvgModelInfo | null => {
      const model = item as Record<string, unknown>;
      const id = String(model.id ?? model.model ?? "");
      if (!id) return null;
      const pricing = Number(model.pricing_credits ?? model.pricingCredits ?? model.credits ?? 0);
      return {
        id,
        name: String(model.name ?? id),
        pricingCredits: Number.isFinite(pricing) && pricing > 0 ? pricing : fallbackModel(id).pricingCredits,
        available: model.available !== false,
        default: id === DEFAULT_MODEL,
        maxQuality: id === MAX_MODEL
      };
    })
    .filter((item): item is SvgModelInfo => Boolean(item));
  return normalized.length ? normalized : FALLBACK_MODELS;
}

function fallbackModel(model: SvgModelId): SvgModelInfo {
  return FALLBACK_MODELS.find((candidate) => candidate.id === model) ?? {
    id: model,
    name: model,
    pricingCredits: model.includes("max") ? 50 : 25,
    available: true,
    default: model === DEFAULT_MODEL,
    maxQuality: model.includes("max")
  };
}

function extractSvg(payload: unknown): string {
  const candidates = [
    (payload as { svg?: unknown })?.svg,
    (payload as { data?: { svg?: unknown } })?.data?.svg,
    (payload as { data?: Array<{ svg?: unknown }> })?.data?.[0]?.svg,
    (payload as { result?: { svg?: unknown } })?.result?.svg,
    (payload as { outputs?: Array<{ svg?: unknown }> })?.outputs?.[0]?.svg
  ];
  const svg = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.includes("<svg"));
  if (!svg) {
    throw new Error("QuiverAI response did not include an SVG payload.");
  }
  return svg;
}

function rateLimitFromHeaders(headers: Headers): QuiverSvgResult["rateLimit"] {
  const limit = numberHeader(headers, "x-ratelimit-limit");
  const remaining = numberHeader(headers, "x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset") ?? undefined;
  if (limit === undefined && remaining === undefined && reset === undefined) {
    return undefined;
  }
  return { limit, remaining, reset };
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function quiverError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  const prefix = response.status === 401
    ? "QuiverAI authentication failed"
    : response.status === 402
      ? "QuiverAI account has insufficient provider credits"
      : response.status === 403
        ? "QuiverAI request is forbidden"
        : response.status === 429
          ? "QuiverAI rate limit exceeded"
          : response.status >= 500
            ? "QuiverAI service error"
            : "QuiverAI request failed";
  return new Error(`${prefix} (${response.status}): ${text.slice(0, 500)}`);
}

function mockSvg(prompt: string, instructions?: string): string {
  const label = escapeXml(prompt.split(/\s+/).slice(0, 5).join(" ") || "Motion asset");
  const subtitle = escapeXml(instructions?.split(/\s+/).slice(0, 7).join(" ") ?? "state-machine ready");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="motionMcpGradient" x1="20" y1="20" x2="140" y2="140" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#38BDF8"/>
      <stop offset="0.52" stop-color="#8B5CF6"/>
      <stop offset="1" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <g id="logo-mark" data-name="logo mark">
    <path id="outer-orbit" d="M80 18C114.242 18 142 45.758 142 80S114.242 142 80 142 18 114.242 18 80 45.758 18 80 18Z" fill="none" stroke="url(#motionMcpGradient)" stroke-width="8"/>
    <path id="energy-ribbon" d="M41 92C57 47 96 44 119 67C97 68 80 79 69 114C61 105 52 98 41 92Z" fill="url(#motionMcpGradient)"/>
    <circle id="spark-core" cx="96" cy="56" r="10" fill="#FDE68A"/>
    <path id="spark-flare" d="M96 31L101 48L118 56L101 64L96 81L91 64L74 56L91 48Z" fill="#FFF7ED" opacity=".86"/>
  </g>
  <text id="asset-label" x="80" y="153" text-anchor="middle" font-size="9" fill="#475569">${subtitle}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
