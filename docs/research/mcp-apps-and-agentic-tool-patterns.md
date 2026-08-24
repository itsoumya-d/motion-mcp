# Research: MCP Apps / "UI over MCP" and agentic tool-design patterns — what they mean for Motion MCP

*Auto-R&D loop, run 001 (2026-08-24). Sources verified live at time of writing; no fabricated numbers.*

## 1. The ecosystem shift: MCP is becoming a UI protocol

The [mcp-ui project](https://github.com/MCP-UI-Org/mcp-ui) (5.1k stars) pioneered embedding interactive
UI inside MCP tool results, and its patterns were folded into the emerging **MCP Apps specification**:
tool responses can now carry a `UIResource` whose payload is HTML tagged with
`mimeType: text/html;profile=mcp-app` under a `ui://` URI scheme, rendered by hosts in a sandboxed iframe
(`AppRenderer` on the client side). In other words: **hosts are becoming surfaces where a tool can draw,
not just print text.**

Why this matters for Motion MCP specifically:

1. **Previews belong in-band.** Today `ensoul_asset` returns a stage-by-stage receipt and preview paths.
   Under MCP Apps, a preview can ship *as a UI resource* — an animated SVG or Lottie player embedded in
   Claude/Codex/ChatGPT's tool-result pane, so review happens without leaving the host.
2. **The diff-as-review-UI thesis gets a native carrier.** Motion MCP's positioning ("the diff is the
   review UI") assumed a terminal. MCP Apps gives that same idea a graphical surface: side-by-side
   before/after state-machine renders inside the conversation.
3. **Competitive read:** Rive's editor-centric pipeline has no story here; an agent operating Rive's GUI
   over MCP cannot stream frames back into the chat. A headless engine that emits `ui://` resources can.

Concrete follow-up queued: emit an optional `uiResource` block from preview-producing tools when the
host advertises MCP Apps support (capability-gated, additive — consistent with the SceneDoc v1
extension policy in [`scenedoc-v1-extensions.md`](../scenedoc-v1-extensions.md)).

## 2. Tool-design patterns for the 52-tool surface

Arcade.dev's pattern catalog ("54 Patterns for Building Better MCP Tools",
[Feb 2026](https://www.arcade.dev/blog/mcp-tool-patterns/), full catalog at
[arcade.dev/patterns](https://www.arcade.dev/patterns)) distills lessons from ~8k production tools into
three classification axes — maturity (atomic → orchestrated), integration type, execution access
(sync → async job) — and four cross-cutting concerns: **agent experience, security boundaries,
error-guided recovery, tool composition**.

Mapping against Motion MCP's current design:

| Pattern (Arcade) | Already present? | Gap / action |
|---|---|---|
| Error-guided recovery (errors tell the agent how to retry) | Partially — attempt ledger records failures | Audit every tool error string for "what should the agent do next" guidance |
| Parameter coercion (accept `"yesterday"` / ISO / loose forms) | Yes for NL intent lexicon in generation | Apply same tolerance to rubric/threshold params |
| Async job pattern (`job_id` + poll) | `ensoul_asset` runs long synchronously | If vision-judge latency grows, split into submit/poll pair |
| Idempotent operations | Not audited | Re-running `ensoul_asset` twice must not double-patch ASTs — verify |
| Security boundary (credentials never reach the model) | Vision judge providers configured via config file | Confirm provider keys stay server-side of the tool surface |

The core insight transfers directly: *"a tool can return the right data and still fail because the agent
couldn't figure out when to call it."* With 52 tools, discoverability descriptions are the product.

## 3. Motion-duration guidance is being codified — feed it into the linter

Third-party agent-cookbook guidelines (e.g. the Agentic Developer Cookbook's
[Animation & Motion recipe](https://agenticdevelopercookbook.com/guidelines/implementing/ui/animation-motion),
v1.0.3, Jun 2026) now publish concrete duration budgets agents are expected to honor:
micro-feedback 50–100ms, state changes 100–200ms, enter/exit 200–350ms, navigation 300–500ms,
complex choreography ≤1000ms; platform-native springs preferred; reduced-motion MUST be respected.

Actionable for Motion MCP:

- The motion-curve linter already flags mechanical easing and velocity discontinuities. It does **not**
  currently enforce duration bands per interaction class. Adding interaction-class duration checks would
  align generated output with what agent-authored UIs are increasingly linted against.
- Reduced-motion handling belongs in the export targets, not just the source app — worth a roadmap item.

## Sources

- https://github.com/MCP-UI-Org/mcp-ui — UIResource wire format, MCP Apps profile MIME type, AppRenderer
- https://www.arcade.dev/blog/mcp-tool-patterns/ — three axes, four cross-cutting concerns, async-job/idempotency/coercion patterns
- https://agenticdevelopercookbook.com/guidelines/implementing/ui/animation-motion — duration budget table, reduced-motion rule
