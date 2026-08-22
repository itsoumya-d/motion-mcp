<div align="center">

# ⚡ Motion MCP

**The AI-native motion engine for coding agents — a codebase-aware alternative to Rive's closed pipeline.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-80%20passing-brightgreen.svg)](./tests)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-native-8A2BE2.svg)](https://modelcontextprotocol.io)
[![Targets](https://img.shields.io/badge/targets-React_·_RN_·_Flutter_·_Unity-ff69b4.svg)](#what-it-builds)

</div>

Motion MCP plugs into Codex, Claude Code, Cursor, or any MCP-compatible agent and turns an **existing codebase** into a living, animated product. It scans your app, understands your screens and flows, writes Rive-like state-machine experience specs, compiles them through an open scene format (**SceneDoc**), generates framework-native animation code for React, React Native, Flutter, and Unity, and stages everything as reviewable diffs that apply only after approval.

> **No rewrites. No invented runtime. No generated app replacing the real one.**
> The motion lands inside *your* components, bound to *your* app state, rendered by *your* stack.

---

## Why not just use Rive?

| | Rive | Motion MCP |
|---|---|---|
| Creation surface | Closed GUI editor | Your coding agent + MCP tools |
| AI role | Operates their desktop editor over local MCP | Is the whole pipeline — headless, codebase-aware |
| Scene format | Proprietary `.riv` binary | **SceneDoc** — open, versioned, diff-friendly JSON |
| Runtime | Their WASM/GPU runtime on every platform | Compiles to each host's native animation system |
| App binding | Designer-guessed inputs (`isLoading`, `progress`…) | Binds to **real** detected app state from your source |
| Code integration | Manual embed of `.riv` files | AST-patched imports staged as reviewable diffs |
| Review workflow | Editor history | Git branches + PRs |

Rive treats AI as an operator of a human-centric editor. Motion MCP deletes the editor: **the repo is the file browser, the chat is the canvas, the diff is the review UI.**

---

## Architecture

```mermaid
flowchart LR
    subgraph AGENT["🤖 Coding Agent (Codex / Claude / Cursor)"]
        T["MCP Tools<br/>26 tools"]
    end

    subgraph RESEARCH["🔍 Understand"]
        S["scan_codebase<br/>scan_assets"] --> R1["auto_research_motion"]
        R1 --> R2["research_app_motion<br/>flows · screens · signals"]
        R2 --> R3["research_state_machine_experience<br/>layers · states · transitions<br/>listeners · ViewModel bindings"]
    end

    subgraph ASSETS["🎨 Asset Lanes"]
        A1["Simple lane<br/>host-model SVG briefs"]
        A2["Premium lane<br/>QuiverAI structured SVG"]
        A3["svg-parser<br/>DOM parse · CSS cascade<br/>transforms · use/defs · gradients"]
        A1 --> A3
        A2 --> A3
    end

    subgraph SCENE["📐 Scene Graph"]
        SG["compileExperienceToScene<br/>deterministic motion grammar<br/>per-state keyframe clips"]
        V["validateSceneDoc<br/>reference sampler"]
        SG --> V
    end

    subgraph EMIT["⚙️ Emit & Integrate"]
        E1["React / Next<br/>Framer Motion · GSAP"]
        E2["React Native / Expo<br/>Reanimated 3 · react-svg"]
        E3["Flutter β<br/>AnimationController"]
        E4["Unity β<br/>UI pointer behavior"]
        P["ast-patcher<br/>TS AST import patching"]
        EX["exporters<br/>Lottie · animated SVG"]
    end

    subgraph SHIP["✅ Ship"]
        D["Staged diffs<br/>.motion-mcp/diffs"]
        PV["preview_animation"]
        AP["apply_motion_diff<br/>+ project validation"]
    end

    T --> S
    R3 -->|"state-machine-experience.json"| SG
    A3 -->|"rig reports · pathTree"| E1
    SG --> E1 & E2 & E3 & E4
    P --> D
    E1 & E2 & E3 & E4 --> D
    SG -.-> EX
    D --> PV --> AP
```

### One spec in, four frameworks out — provably identical

`generate_animation` no longer stamps a fixed template. It loads `state-machine-experience.json`, compiles it into a **SceneDoc artboard**, and every emitter renders *that* — real states, real transitions, real keyframes. A conformance harness pins this contract byte-for-byte across all four targets.

---

## SceneDoc — the open scene format

SceneDoc is motion-mcp's unified interchange format. It merges the two worlds that normally live apart in motion tools: **interactive UI state machines** (Rive-like) and **keyframed character clips** (baked skeletal data).

```jsonc
{
  "formatVersion": 1,
  "sceneId": "scene_landing",
  "artboards": [{
    "artboardId": "page_cta",
    "sourceFile": "app/page.tsx",
    "layers": [
      { "layerId": "layer_main", "targetParts": ["cta-glow", "cta-label"], "initialStateId": "state_idle" }
    ],
    "clips": {
      "clip-state_success": {                       // compiled by the motion grammar
        "durationMs": 620,
        "tracks": [
          { "targetPart": "*", "property": "scale",
            "keys": [{ "t": 0, "value": 1 }, { "t": 240, "value": 1.08, "easing": "easeOut" }, { "t": 620, "value": 1 }] },
          { "targetPart": "*", "property": "rotate",
            "keys": [{ "t": 0, "value": 0 }, { "t": 240, "value": 1.5 }, { "t": 620, "value": 0 }] }
        ]
      }
    },
    "stateMachines": [{
      "initialStateId": "state_idle",
      "states": [{ "stateId": "state_hover", "name": "Hover", "kind": "single", "clipId": "clip-state_hover" }],
      "transitions": [{ "fromStateId": "state_idle", "toStateId": "state_hover", "event": "pointerEnter",
                        "durationMs": 180, "interpolation": "spring" }]
    }],
    "bindings": [{ "property": "isLoading", "targetPart": "cta-label", "source": "app-state" }],
    "semantics": { "reducedMotionSafe": true }
  }]
}
```

### The motion grammar

Semantic states compile deterministically into keyframed clips — same input, same output, every time:

| State semantics | Compiled motion | Duration |
|---|---|---|
| idle / rest / breathe | breathe scale `1 → 1.012 → 1` + opacity swell (looping) | 3400 ms |
| hover | lift `y −2`, scale `1.012` easeOut | 180 ms |
| press / down | depress scale `0.965` | 80 ms |
| success / reward | pop `1 → 1.08 → 1` + rotate wiggle | 620 ms |
| error / warn | shake x `[0, −2, 2, −1, 0]` | 340 ms |
| active / selected | pathLength draw-in + spring scale | 420 ms |
| disabled | hold at opacity `0.48` | hold |

Per-part staggering is baked into keyframe times, so multi-part assets choreograph themselves. A reference sampler (`sampleSceneTrack`) evaluates any track deterministically — it is the ground truth the conformance suite pins against.

---

## Package architecture

```mermaid
graph TD
    subgraph SERVER["MCP Server (@motion-mcp/server)"]
        MCP["26 MCP tools · stdio + HTTP bridge"]
    end

    subgraph UNDERSTAND["Understanding"]
        CS["codebase-scanner"]
        AR["app-researcher"]
        AU["auto-researcher"]
        SMR["state-machine-researcher"]
        MP["motion-planner"]
    end

    subgraph CORE["Core Engines"]
        SP["svg-parser<br/>@xmldom/xmldom"]
        SGR["scene-graph<br/>SceneDoc v1"]
        AE["anatomy-engine<br/>species rigs"]
        MR["motion-runtime<br/>zero-dep clip player"]
    end

    subgraph EMITTERS["Emitters"]
        ER["emitter-react"]
        ERN["emitter-react-native"]
        EF["emitter-flutter β"]
        EU["emitter-unity β"]
    end

    subgraph SUPPORT["Support"]
        QP["quiver-provider<br/>rotation · retries · pricing"]
        CL["credits-ledger<br/>reserve→commit→refund"]
        AP2["ast-patcher<br/>TypeScript API"]
        VA["validator"]
        ST["shared-types"]
    end

    MCP --> UNDERSTAND & CORE & SUPPORT
    CS --> AR --> SMR --> SGR
    AU --> SMR
    MP --> SGR
    SP -->|"pathTree · rig reports"| AE & SGR
    SGR --> EMITTERS
    MR -->|"MotionDoc ⇄ SceneClip"| SGR
    AP2 -->|"patchIntoSource"| SERVER
    ST -.->|"types everywhere"| SERVER & UNDERSTAND & CORE & EMITTERS & SUPPORT
```

| Package | Role |
|---|---|
| `server` | MCP stdio server + HTTP bridge exposing all tools |
| `codebase-scanner` | Framework detection, deps, entry points, component inventory |
| `app-researcher` | Screens, flows, ranked screen motion plans, asset-lane decisions |
| `auto-researcher` | Source-backed research engine: findings → scored opportunities → context packs |
| `state-machine-researcher` | Rive-like per-page experience specs (layers, states, transitions, listeners, bindings) |
| `svg-parser` | Real DOM parsing: style cascade, composed transforms, `<use>`/`<defs>` expansion, gradient registry |
| `scene-graph` | **SceneDoc v1**: compiler, motion grammar, validator, reference sampler |
| `anatomy-engine` | Species-aware SVG anatomy (`human-biped`, `avian-crow`) → semantic actions |
| `motion-runtime` | Zero-dependency skeletal FK player: keyframed clips, crossfade layers, hysteresis rep counting |
| `emitter-react` / `-react-native` | Framer Motion variants + transition tables / Reanimated 3 + `react-native-svg` |
| `emitter-flutter` / `-unity` (β) | AnimationController wrappers / UI pointer behavior, DOTween-ready |
| `player` | Zero-dep `ScenePlayer` + `<motion-scene>` web component: transitions, deterministic seek, reduced-motion |
| `exporters` | Lottie JSON writer (bezier paths incl. arc→cubic) · CSS-keyframe animated SVG |
| `riv-importer` | Rive binary format reader per the public spec — fingerprint, ToC backing types, object stream, graceful truncation |
| `ast-patcher` | Surgical import/usage patches via the TypeScript compiler API |
| `quiver-provider` | Premium SVG generation with key rotation, backoff, live pricing sync |
| `credits-ledger` | Reserve → commit/refund credit integrity with local ledger |
| `validator` | Post-apply typecheck/build validation per framework |

---

## What it builds

| Target | Runtime | Status | Output |
|---|---|---|---|
| React / Next.js | Framer Motion, GSAP-ready | ✅ stable | Animated SVG components + enhancer wrappers, scene-driven variant tables |
| Expo / React Native | Reanimated 3 + react-native-svg | ✅ stable | Pressable shells, shared-value tweens, accessibility-aware |
| Flutter | AnimationController, CustomPainter hooks | 🧪 beta | Enum-driven host-code state machines |
| Unity | UI EventSystem, DOTween-ready | 🧪 beta | Pointer interaction behavior scripts |

Every generated component ships with: reduced-motion handling, semantic labels, controlled/uncontrolled state support, and a host-side state machine you own — nothing phones home at runtime.

## MCP tools (28)

**Understand the codebase**

| Tool | Purpose |
|---|---|
| `scan_codebase` | Framework, deps, entry points, components, animation libs |
| `scan_assets` | Index SVG/Lottie/Rive/images with parsed anatomy trees |
| `get_app_motion_context` | Combined context: screens, flows, tokens, motion thesis |

**Research & plan**

| Tool | Purpose |
|---|---|
| `feed_concept` | Inject brand concept + personality + logo |
| `plan_microinteractions` | Rank micro-interaction opportunities |
| `auto_research_motion` | Source-backed findings → ranked opportunities → context packs |
| `research_app_motion` | Flow-level motion briefs |
| `research_state_machine_experience` | Rive-like page specs before any code is written |
| `plan_screen_motion` | Per-screen moment ranking (brand memory, confidence, delight…) |

**Generate assets**

| Tool | Purpose |
|---|---|
| `estimate_asset_lane` | Simple vs premium lane decision + cost |
| `generate_simple_svg_asset` | Strict SVG brief/checklist for the host model (or direct ingest) |
| `ingest_svg_asset` | Validate + stage any SVG with rig report |
| `generate_premium_svg_asset` | QuiverAI structured SVG generation |
| `generate_svg_asset` / `vectorize_asset` | Direct Quiver calls (image → vector too) |
| `generate_asset_batch` | Up to 64 items, dry-run costing, per-item isolation |
| `analyze_svg_anatomy` / `resolve_anatomy_action` | Species detection; blink/wave/flap/caw resolution |
| `list_svg_models` / `estimate_motion_cost` | Live model pricing |

**Animate & ship**

| Tool | Purpose |
|---|---|
| `generate_animation` | SceneDoc-compiled native motion code (options: `style`, `trigger`, `intensity`, `framework`, `patchIntoSource`, `usageAnchor`) |
| `preview_animation` / `apply_motion_diff` | Inspect then apply staged diffs with validation |
| `export_animation` | Bake a SceneDoc state into **Lottie JSON** or self-contained **animated SVG** |
| `import_riv` | **Migration wedge**: validate any `.riv`, extract its inventory (objects, names, types), stage a SceneDoc skeleton + report |
| `curate_workout` | Deterministic workout composition for the exercise stack |
| `get_credit_balance` / `purchase_credits_url` | Credit ops |

Every generated/ingested SVG carries a **rig report**: which roles (`eyes`, `head/body`, `mouth/beak`, `limb/wing`, `tail`, `shadow`, `sparkle`) were detected, what they can bind to (eye-follow, blink, press-depress…), and what's missing — verify state-machine readiness before generating code.

---

## Quality gates: conformance, goldens, determinism

```bash
pnpm test          # node --test — 80 assertions across 16 suites
pnpm typecheck     # strict TS across all 20 packages
pnpm build         # topological build
```

Highlights:

- **Conformance harness** — one canonical SceneDoc fixture drives all four emitters. Asserts every scene state appears in each target's output, transition edges survive compilation, and legacy mode stays byte-stable.
- **Golden frames without a browser** — pinned numeric samples from the reference evaluator (e.g. success-pop scale at `t=120ms ⇒ 1.06 ± 1e-9`) define the timing truth every future renderer must honor.
- **Byte-deterministic generation** — identical inputs produce identical files modulo timestamps.
- **Real parser tests** — multi-line attributes, comments, entities, transform composition, CSS specificity, `<use>` cycles, malformed-input resilience.

---

## Asset lanes, QuiverAI, credits

Two lanes, one pipeline:

- **Simple lane** — the host coding model generates SVG from a strict brief + acceptance checklist; `ingest_svg_asset` validates and indexes it. Zero marginal cost.
- **Premium lane** — QuiverAI structured SVG when complexity or brand importance justifies credits. Keys stay server-side.

Resilience built in:

- `QUIVERAI_API_KEYS` round-robins comma-separated keys, rotating away on `401/402/429`
- Exponential-backoff retries on `429`/`5xx`, honoring `x-ratelimit-reset`
- Fallback pricing matches live Quiver rates (`arrow-1.1` = 20 cr, `arrow-1.1-max` = 25 cr)
- Batch mode isolates failures — one bad item never aborts 64
- Credits reserve `ceil(quiver_price × 2)`, commit only after a usable SVG stages

Production billing defaults: Free 100 cr/mo · Pro $20/mo 2,000 cr · Team $50/seat 5,000 cr · Topup $10/1,000 cr.

---

## 3D Exercise Stack

Beyond UI motion, the same engines drive a full exercise system:

- [`anatomy-engine`](./packages/anatomy-engine) — species schemas turn plain SVGs into rigged characters: a crow "waves" with wing lift + head bob; a human waves with arms
- [`motion-runtime`](./packages/motion-runtime) — zero-dep humanoid skeleton player: squat/jumping-jack/curl/lunge clips, base+overlay crossfading, hysteresis rep counting
- [`apps/exercise-demo`](./apps/exercise-demo) — web studio: procedural character, cheer/form overlays, optional BlazePose camera rep counting, SVG mascots reacting to the same event stream
- [`apps/exercise-mobile`](./apps/exercise-mobile) — Expo shell running the *identical* runtime via pure-TS FK projected into `react-native-svg`
- [`pipeline/`](./pipeline) — Python offline baking: MotionDoc interchange, RDP reduction + quantization, retarget solver, ARDY adapter. Baked JSON plays directly via `sceneClipFromMotionDoc`

```bash
pnpm --filter @motion-mcp/exercise-demo dev   # http://localhost:5175
```

---

## Getting started

```bash
pnpm install
pnpm build
pnpm dev:mcp          # stdio MCP server
```

Wire it into your agent — e.g. Claude Code:

```bash
claude mcp add motion-mcp -- node /absolute/path/to/motion-mcp/packages/mcp-server/dist/index.js
```

Or add to `.mcp.json` (this repo ships one — it doubles as a local Codex plugin via `.codex-plugin/plugin.json`):

```json
{ "mcpServers": { "motion-mcp": { "command": "node", "args": ["packages/mcp-server/dist/index.js"] } } }
```

Local dev notes: credits ledger lives in `.motion-mcp/credits.json` with a default grant; Quiver runs in deterministic mock mode unless keys are set (`MOTION_MCP_QUIVER_MOCK=1` forces mock).

### Example agent session

```text
scan_codebase({ rootPath: "." })
scan_assets({ rootPath: "." })
feed_concept({ brandConcept: "…", brandPersonality: ["precise","alive","playful"], logoSvgPath: "public/logo.svg" })
auto_research_motion({ brief: "highest-leverage motion improvements" })
research_state_machine_experience({ brief: "Rive-like page specs first" })

estimate_asset_lane({ screenId, assetBrief: "premium animated logo mark" })
generate_premium_svg_asset({ assetBrief: "…", placement: { screenId, moment: "first brand impression" } })

generate_animation({
  componentId,
  options: { intensity: "expressive", patchIntoSource: true, usageAnchor: "<Button>Buy</Button>" }
})
preview_animation({ diffId })     // inspect the staged diff
apply_motion_diff({ diffId })     // writes files + runs project validation
```

### Repository layout

```text
motion-mcp/
├── packages/               # 20 workspace packages (see architecture above)
├── apps/
│   ├── exercise-demo/      # Web studio demo
│   ├── exercise-mobile/    # Expo shell
│   └── web/                # Landing page
├── examples/next-app       # Reference integration with real .motion-mcp artifacts
├── pipeline/               # Offline Python bake pipeline (ARDY-ready)
├── skills/motion-mcp/      # Canonical 13-step agent workflow
└── tests/                  # 16 suites incl. conformance harness
```

---

## Roadmap

**Shipped — Phase A foundations**

- ✅ `svg-parser`: DOM-based parsing replaces regex scanners everywhere
- ✅ `scene-graph`: SceneDoc v1 + deterministic motion grammar + validation + reference sampler
- ✅ Spec-to-code disconnect closed: experiences compile through SceneDoc into all four emitters
- ✅ `ast-patcher`: generated imports staged into real source files behind flags
- ✅ Conformance harness with cross-target goldens

**Phase B: portability (in motion)**

- ✅ `@motion-mcp/player`: `ScenePlayer` (transition graph, loop-aware seek, reduced-motion) + `<motion-scene>` web component
- ✅ `@motion-mcp/exporters`: Lottie JSON (full path→bezier incl. arcs) · animated SVG with baked keyframes
- ✅ `export_animation` MCP tool writing `.motion-mcp/exports/`

- ✅ `@motion-mcp/riv-importer`: binary reader per the public `.riv` spec (header, ToC backing-type bits, object stream) + `import_riv` tool

Remaining:

1. MP4/GIF headless capture from the player's seek API
2. Playwright visual snapshots for staged diffs
3. Full geometry/state-machine mapping from `.riv` type tables into SceneDoc

**Then — Phase C/D: ecosystem**

5. Dynamic context engine (live re-index on file change)
6. Critique agent + motion-grammar dataset from accept/reject/edit telemetry
7. Stripe + Supabase billing mirror · hosted preview links · CI

---

## License

[Apache-2.0](./LICENSE) © motion-mcp contributors
