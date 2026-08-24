export type MotionAction =
  | "bounce"
  | "spin"
  | "shake"
  | "pulse"
  | "nod"
  | "wave"
  | "jump"
  | "sway"
  | "blink"
  | "slide";

export interface MotionIntent {
  action: MotionAction;
  loop: boolean;
  speed?: "fast" | "slow";
  intensity?: "subtle" | "exaggerated";
  direction?: "left" | "right" | "up" | "down";
}

export interface ParsedPrompt {
  primary: MotionIntent;
  all: MotionIntent[];
  /** Prompt words that contributed nothing — surfaced so agents can rephrase. */
  unmatchedTokens: string[];
}

const ACTION_LEXICON: Array<{ action: MotionAction; patterns: RegExp[] }> = [
  { action: "bounce", patterns: [/\bbounc/i, /\bhopp/i, /\bdribbl/i] },
  { action: "spin", patterns: [/\bspin/i, /\brotat/i, /\bwhirl/i, /\btwirl/i, /\bturn\b/i] },
  { action: "shake", patterns: [/\bshak/i, /\btrembl/i, /\bvibrat/i, /\bwiggl?e/i, /\bjitt/i, /\berr?or\b/i] },
  { action: "pulse", patterns: [/\bpuls/i, /\bbreath/i, /\bidle\b/i, /\bbeat/i, /\bthrob/i, /\bglow/i] },
  { action: "nod", patterns: [/\bnod/i, /\bagree/i, /\byes\b/i] },
  { action: "wave", patterns: [/\bwave/i, /\bgreet/i, /\bhello\b/i, /\bhi\b/i, /\bfarewell/i, /\bbye\b/i] },
  { action: "jump", patterns: [/\bjump/i, /\bleap\b/i, /\bhurdle/i, /\bvault\b/i] },
  { action: "sway", patterns: [/\bsway/i, /\bswing/i, /\bdrift/i, /\bfloat/i, /\brock\b/i] },
  { action: "blink", patterns: [/\bblink/i, /\bwink\b/i, /\beye\b/i] },
  { action: "slide", patterns: [/\bslide\b/i, /\bdash\b/i, /\bscoot\b/i, /\bglide\b/i, /\benter\b/i, /\barrive/i] }
];

const LOOP_HINTS = /\b(loop\w*|forever|continuous\w*|ambient|idle|always|endless)\b/i;
const FAST_HINTS = /\b(fast|quick\w*|snappy|rapid|brisk|sudden\w*)\b/i;
const SLOW_HINTS = /\b(slow|gentle|calm|lazy|drift(ing)?)\b/i;
const SUBTLE_HINTS = /\b(subtle|slight\w*|small|tiny|soft|micro\w*)\b/i;
const EXAGGERATED_HINTS = /\b(exaggerat\w*|big|wild|dramatic|energetic|crazy|huge)\b/i;

const KNOWN_WORDS: RegExp[] = [
  ...ACTION_LEXICON.flatMap((entry) => entry.patterns),
  LOOP_HINTS,
  FAST_HINTS,
  SLOW_HINTS,
  SUBTLE_HINTS,
  EXAGGERATED_HINTS,
  /\b(left|right|up|down|to the (left|right))\b/i,
  /\b(make|it|the|and|then|with|a|an|of|on|into|motion|animate|animation|move|movement|please|character|asset|svg|part|parts|feels?|like|alive|life|living)\b/gi
];

/**
 * Deterministic natural-language intent parsing — a curated lexicon, not an
 * LLM call. Same prompt always yields the same intents; unknown verbs fall
 * back to `pulse` (ambient life) and say so. Host models can layer richer
 * parsing on top; this guarantees generation never hallucinates timing.
 */
export function parseMotionPrompt(prompt: string): ParsedPrompt {
  const lowered = prompt.toLowerCase();

  const matchedActions: PositionedIntent[] = [];
  for (const entry of ACTION_LEXICON) {
    let at = Infinity;
    for (const pattern of entry.patterns) {
      const found = pattern.exec(lowered);
      if (found && found.index < at) at = found.index;
    }
    if (at !== Infinity) {
      matchedActions.push({
        action: entry.action,
        loop: inferLoop(entry.action, lowered),
        speed: FAST_HINTS.test(lowered) ? "fast" : SLOW_HINTS.test(lowered) ? "slow" : undefined,
        intensity: SUBTLE_HINTS.test(lowered)
          ? "subtle"
          : EXAGGERATED_HINTS.test(lowered)
            ? "exaggerated"
            : undefined,
        direction: inferDirection(entry.action, lowered),
        at
      });
    }
  }
  matchedActions.sort((a, b) => a.at - b.at);

  const unmatchedTokens = lowered
    .split(/[^a-z0-9']+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !KNOWN_WORDS.some((pattern) => new RegExp(pattern.source, pattern.flags.replace("g", "")).test(token)));

  if (matchedActions.length === 0) {
    const fallback: MotionIntent = {
      action: "pulse",
      loop: true,
      speed: SLOW_HINTS.test(lowered) ? "slow" : undefined,
      intensity: undefined,
      direction: undefined
    };
    return {
      primary: fallback,
      all: [fallback],
      unmatchedTokens
    };
  }

  const stripped: MotionIntent[] = matchedActions.map(({ at, ...intent }) => {
    void at;
    return intent;
  });
  return { primary: stripped[0]!, all: stripped, unmatchedTokens };
}

interface PositionedIntent extends MotionIntent {
  at: number;
}

function inferLoop(action: MotionAction, lowered: string): boolean {
  if (LOOP_HINTS.test(lowered)) return true;
  return action === "pulse" || action === "sway" || action === "blink";
}

function inferDirection(action: MotionAction, lowered: string): MotionIntent["direction"] | undefined {
  if (action !== "slide" && action !== "shake") return undefined;
  if (/\bleft\b/.test(lowered)) return "left";
  if (/\bright\b/.test(lowered)) return "right";
  if (action === "slide" && /\bup\b/.test(lowered)) return "up";
  if (action === "slide" && /\bdown\b/.test(lowered)) return "down";
  return action === "slide" ? "right" : "left";
}
