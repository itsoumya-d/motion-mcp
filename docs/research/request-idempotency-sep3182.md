# Request Idempotency for Agentic Motion Tools (SEP-3182)

_Run date: 2026-08-26. Topic: retry-safe tool design, applied to `ensoul_asset`._

## The problem

MCP has no way for a server to distinguish "this request never arrived" from
"this request arrived, executed, and the response was lost". A client (or the
model driving it) retrying after a dropped connection or timeout therefore
re-executes side effects. For motion tools the side effects are real: artifact
staging under `.motion-mcp/`, credit consumption (`ensoul_asset` costs 12
credits per call), and minutes of generation work. SEP-1686 (Tasks) explicitly
deferred this to "a dedicated proposal"; independent implementations have been
reinventing incompatible ad hoc conventions in the meantime.

## The proposal

**SEP-3182 — Request Idempotency**
https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3182

- Adds an optional `params.idempotencyKey` field to `tools/call`: a server that
  has already processed a key returns the original result instead of
  re-executing.
- Adds a `tools.idempotency` capability for negotiation; both field and
  capability are opt-in and additive.
- Explicit conflict semantics: the same key reused with **different arguments**
  is rejected outright, never replayed or silently executed.
- Open review threads (as of this writing): equivalence rules for MRTR
  continuation requests (`inputResponses` / `requestState` are not yet part of
  the key-equivalence comparison), and the reference implementation initially
  passed the key as a tool argument rather than a request field.

## Complementary guidance

- **Connector design guide on idempotent write retries** — deterministic keys
  derived from operation name + inputs beat random UUIDs generated at call time
  (a fresh random key per retry defeats dedup); delete-of-deleted should return
  success; tool descriptions must state the retry guarantee explicitly.
  https://connector.zone/guides/idempotency-in-mcp-tool-write-retries/
- **Tool annotations as the machine-readable contract** — `idempotentHint`,
  `readOnlyHint`, `destructiveHint` let hosts auto-approve safe retries and
  checkpoint destructive ones. Annotations are advisory; enforcement stays
  server-side. https://dev.to/frihet/designing-mcp-tools-an-agent-wont-misuse-1ah1
- **Determinism and bounded side effects checklist** — explicit state, typed
  errors agents can branch on, bounded resources.
  https://docs.axonos.ai/flow/nodes/agentic-ai/mcp-safety
  https://agentpatterns.ai/tool-engineering/mcp-server-design/

## What we implemented in motion-mcp

`ensoul_asset` is now retry-safe at the application layer, ahead of any client
adopting SEP-3182's wire field:

1. **Derived key** (`packages/mcp-server/src/idempotency.ts`) — SHA-256 over a
   canonical JSON of the input (object keys sorted recursively, test seams like
   `_initialDoc` excluded). Per the connector-guide guidance, no random UUIDs:
   the same intended operation always maps to the same key, so clients need not
   supply or persist anything. Because the key is a hash of the arguments, the
   SEP's key-reuse-with-different-arguments conflict case is impossible by
   construction.
2. **Replay ledger** — first execution records its full result under
   `.motion-mcp/idempotency/<key>.json`. A retry loads it and returns the
   original receipt verbatim with `replayed: true` plus an explanatory note;
   nothing re-executes, re-stages, or re-burns credits.
3. **Annotation + description** — `ensoul_asset` now carries
   `idempotentHint: true` (with `readOnlyHint: false`,
   `destructiveHint: false`, `openWorldHint: false) and its description states
   "Safe to retry", per the Frihet annotation-contract pattern.

### Deliberate deviations / notes

- We derive the key server-side instead of waiting for `params.idempotencyKey`.
  When the SEP lands and SDKs expose the request field, a caller-supplied key
  should take precedence; the derived key remains the fallback for callers that
  don't send one.
- The ledger is unbounded per workspace. A retention window (SEP-3182 discusses
  one) is future work; entries are small JSON files and cheap, but a long-lived
  workspace will want pruning.
- Only `ensoul_asset` is covered today. The next candidates by blast radius are
  `rig_asset` and the video-rig pipeline (both stage artifacts + consume
  credits).

## Tests

`tests/ensoul-idempotency.test.ts`: key stability across argument order and
excluded seams; identical retry replays the recorded result (same docPath,
verbatim stages, `replayed: true`, exactly one ledger entry); a different
prompt maps to a different key and executes fresh (second ledger entry).
