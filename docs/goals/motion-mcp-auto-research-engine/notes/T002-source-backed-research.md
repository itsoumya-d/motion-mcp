# T002 Source-Backed Research

## Scope

Research target: make Motion MCP best-in-category as a local, mockable, codebase-aware motion plugin for AI coding agents across React/Next, Expo/React Native, Flutter, Unity, apps, websites, and games.

Runtime constraint for tranche one: use web/GitHub research during development, but do not require hosted crawlers, paid APIs, production credentials, Supabase, Stripe, or non-mockable external services at runtime.

## Source-Backed Findings

### Rive-Like Interactive Motion

- Rive state machines are graph-based motion logic: states, transitions, layers, and a graph that maps from one animation timeline to another. Source: https://rive.app/docs/editor/state-machine/state-machine
- Rive states include entry, exit, any, single animation, and blend states. This supports reusable interaction logic beyond hover/tap. Source: https://rive.app/docs/editor/state-machine/states
- Rive transitions are not just edges; they carry timing, exit-time, conditions, interpolation, and actions. Source: https://rive.app/docs/editor/state-machine/transitions
- Rive layers let multiple single-state flows mix, with priority decided by layer order. Source: https://rive.app/docs/editor/state-machine/layers
- Rive View Models define reusable data structures with typed properties and instances; bindings let text, images, colors, animations, state machines, and other properties react to data changes. Source: https://rive.app/docs/editor/data-binding/view-models
- Rive runtimes are open-source wrappers over a low-level runtime. The C++ runtime loads `.riv`, advances state machines, and renders through GPU backends; web runtime exposes high-level APIs for interactions/state machines and low-level render control. Sources: https://github.com/rive-app/rive-runtime and https://github.com/rive-app/rive-wasm

Implication for Motion MCP: The replacement experience must preserve the mental model of named states, layers, transitions, listeners, actions, and view-model-like data contracts, but emit inspectable host code rather than sealed `.riv` behavior.

### Lottie / Vector Playback

- Lottie-web parses Bodymovin-exported After Effects JSON and renders it across Web, Android, iOS, React Native, and Windows. Source: https://github.com/airbnb/lottie-web
- The Lottie ecosystem has many runtime implementations, including Skottie, rlottie, dotlottie-rs, ThorVG, Qt Lottie, and others. Source: https://lottie.github.io/implementations/

Implication for Motion MCP: Lottie’s strength is broad playback and designer-exported animation. Motion MCP can differentiate by generating and wiring motion directly in the codebase, with source-backed context and state binding, instead of treating motion as a static exported clip.

### React / Web Animation

- Motion for React supports motion components, variants, gestures, keyframes, SVG elements, layout, scroll, transitions, and reduced-motion utilities. Sources: https://motion.dev/docs/react-animation and https://motion.dev/docs/react-gestures
- Motion `useAnimate` supports scoped manual animation controls, local selector scoping, timelines, and automatic cleanup. Source: https://motion.dev/docs/react-use-animate
- GSAP timelines provide precise sequencing, nested timelines, callbacks, and whole-sequence controls. Source: https://gsap.com/docs/v3/GSAP/Timeline/

Implication for Motion MCP: React/Next codegen should emit a typed state-machine hook plus Motion variants for common states, and optionally scoped `useAnimate`/GSAP timelines for page-level choreography.

### Expo / React Native

- Reanimated shared values carry mutable animatable data across the JS and UI threads and drive animations reactively. Source: https://docs.swmansion.com/react-native-reanimated/docs/2.x/fundamentals/shared-values/
- Reanimated `useAnimatedProps` animates third-party component props, which is the key path for animating `react-native-svg` nodes. Source: https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedProps/
- `react-native-svg` provides SVG support for React Native on iOS, Android, macOS, Windows, and web, and supports most SVG elements/properties. Source: https://github.com/software-mansion/react-native-svg

Implication for Motion MCP: Expo/RN codegen should map view-model properties to shared values and animated props over real SVG paths, with a reduced-motion fallback and no placeholder geometry.

### Flutter

- Flutter animation fundamentals center on `AnimationController`, `CurvedAnimation`, `Tween`, listeners/status listeners, and vsync. Source: https://docs.flutter.dev/ui/animations
- Explicit/custom animation surfaces can be represented with `AnimatedBuilder`/`AnimatedWidget`, while complex assets may use `CustomPainter`.

Implication for Motion MCP: Flutter should remain beta until codegen supports state enums, `AnimationController`, binding contracts, and generated painters/widgets against actual asset parts.

### Unity / Games

- Unity Animator state machines are graphs of states and transitions, with parameters used to communicate between scripts and animation controllers. Source: https://docs.unity3d.com/Manual/AnimationStateMachines.html
- Unity UI Toolkit supports USS transitions triggered by pseudo-classes, C# methods, or events; transitions define property, duration, timing function, and delay. Source: https://docs.unity3d.com/6000.3/Documentation/Manual/UIE-Transitions.html
- UI Toolkit pointer events provide a cross-device input event surface. Source: https://docs.unity3d.com/2022.3/Documentation/Manual/UIE-Pointer-Events.html
- DOTween sequences provide code-first tween sequencing with append, join, insert, intervals, and callbacks. Source: https://dotween.demigiant.com/documentation.php

Implication for Motion MCP: Unity should stay beta but expose a C# enum state-machine contract, pointer/focus/listener mapping, and DOTween sequence generation when DOTween is detected.

### Product Motion / Accessibility / Game Feel

- Material motion guidance frames motion as feedback that communicates status and system action. Source: https://m2.material.io/design/motion/understanding-motion.html
- Material 3 describes a physics-based motion system designed to feel alive, fluid, and natural. Source: https://m3.material.io/styles/motion/overview/how-it-works
- Apple HIG motion guidance frames motion as a way to convey status, feedback, instruction, and visual richness, while Apple accessibility guidance requires respecting Reduce Motion. Sources: https://developer.apple.com/design/human-interface-guidelines/motion and https://developer.apple.com/design/human-interface-guidelines/accessibility

Implication for Motion MCP: The research engine must rank restraint and accessibility alongside delight. Best-in-category means choosing the few highest-leverage moments, not animating everything.

### Context Engineering / Agent Workflows

- Andrej Karpathy’s context-engineering framing favors giving the model the right information for the next step, not one giant prompt. Source: https://x.com/karpathy/status/1937902205765607626
- LangChain groups context engineering strategies around writing, selecting, compressing, and isolating context for each agent step. Source: https://www.langchain.com/blog/context-engineering-for-agents

Implication for Motion MCP: A runtime auto-research workflow should output context packs: source-backed findings, selected local files, constraints, target framework, safe operations, ranked opportunities, and verification commands for the next agent action.

### QuiverAI Premium SVG Lane

- QuiverAI’s API exposes text-to-SVG via `POST /v1/svgs/generations`, models through `GET /v1/models`, live `pricing_credits`, and default rate limits/error codes. Sources: https://docs.quiver.ai/api-reference/create-svgs/text-to-svg, https://docs.quiver.ai/api/pricing, and https://docs.quiver.ai/getting-started/quickstart
- Arrow 1.1 is the default recommendation; Arrow 1.1 Max is for higher-fidelity dense/technical/detail-sensitive SVGs. Source: https://docs.quiver.ai/getting-started/quickstart

Implication for Motion MCP: Auto-research should help decide when host-model SVG is enough and when Quiver quality is worth credits.

## Best-In-Category Gaps Motion MCP Can Close Locally

1. Codebase-aware motion decisions: Existing tools animate assets; Motion MCP can identify the right screens, flows, state bindings, and restraint rules from the repo.
2. Host-code state machines: Rive hides logic in `.riv`; Motion MCP can generate typed, reviewable framework-native code.
3. Source-backed agent context: Most AI coding workflows rely on ad hoc prompts; Motion MCP can give Codex/Claude a curated context pack with sources, local files, constraints, and verification.
4. Two-lane SVG generation: Simple assets can be generated by the host model and ingested; Quiver can be reserved for brand-critical or complex SVGs.
5. Cross-platform contracts: One view-model/state-machine spec can map to React, Expo, Flutter, and Unity emitters with stable/beta flags.
6. Verification receipts: Every research-driven opportunity should ship with local commands and smoke checks.

## Source Normalization Needs

- Stable source ID, title, URL/repo, kind (`official-doc`, `repo`, `article`, `platform-guideline`, `api-doc`, `community-reference`), platform tags, topic tags, license when known, retrieved date, summary, relevant constraints, and confidence.
- Findings must reference source IDs, not just prose.
- Opportunities must reference both source IDs and local code evidence.
- Runtime package should use a curated seed source catalog and optional caller-provided sources; no network dependency in tranche one.

## Opportunity Ranking Criteria

- User impact: brand memory, confidence, reward, affordance clarity, perceived speed, conversion, game feel.
- Source support: number/quality of official docs or primary repos backing the pattern.
- Local fit: detected framework, dependencies, screens, assets, design tokens, and existing animation libraries.
- Implementation effort: files touched, framework maturity, dependency risk, emitter support, diff size.
- Verification strength: whether local tests/typechecks/smoke checks can prove the improvement.
- Safety/restraint: reduced-motion support, blast radius, non-replacement of existing assets, and production/beta target status.
- Cost lane: simple host-model SVG vs premium Quiver, with live/fallback credit estimates when relevant.

## Candidate Context-Pack Shape

```json
{
  "contextPackId": "ctxpack_*",
  "purpose": "Select and implement the highest-value local motion improvement",
  "rootPath": "/repo",
  "targetFrameworks": ["next", "expo"],
  "selectedFiles": [
    { "path": "apps/web/app/page.tsx", "reason": "primary product surface" }
  ],
  "sourceIds": ["rive-state-machine", "motion-react-gestures"],
  "localEvidence": [
    "research_app_motion detected dashboard and billing flow",
    "state_machine_experience marked React page readyForCodegen"
  ],
  "constraints": [
    "local/mockable only",
    "do not replace existing assets by default",
    "respect reduced motion"
  ],
  "recommendedToolSequence": [
    "research_app_motion",
    "research_state_machine_experience",
    "estimate_asset_lane",
    "generate_simple_svg_asset or generate_premium_svg_asset",
    "generate_animation",
    "preview_animation",
    "apply_motion_diff"
  ],
  "verificationCommands": [
    "/opt/homebrew/bin/node --test --import tsx tests/*.test.ts"
  ]
}
```

## First Tranche Recommendation

Implement `@motion-mcp/auto-researcher` as a local curated research engine that:

1. Normalizes a seed source catalog.
2. Loads or creates app motion context and state-machine experience.
3. Produces source-backed findings grouped by category.
4. Ranks local implementation opportunities by impact, source support, fit, effort, verification, safety, and SVG lane cost.
5. Emits one or more context packs for Codex/Claude to act on.
6. Writes `.motion-mcp/auto-research.json`.
7. Exposes an MCP tool and HTTP bridge handler.
8. Has tests proving source normalization, ranking, context-pack construction, and an MCP smoke path.

