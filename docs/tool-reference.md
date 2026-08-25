# Tool reference

All **52 tools** are served over stdio (default) and, when
`MOTION_MCP_HTTP_PORT` is set, through the HTTP tool bridge
(`POST /tool/<name>`, bearer-authenticated when `MOTION_MCP_HTTP_TOKEN` is
configured). Descriptions below are extracted verbatim from the registered
schemas in `packages/mcp-server/src/index.ts`.

Every mutating tool stages a reviewable diff; nothing touches your project
until you call `apply_motion_diff`. See
[CONTRIBUTING.md](../CONTRIBUTING.md) before adding a tool.

## Understand & research

| Tool | What it does |
|---|---|
| `scan_codebase` | Detect framework, dependencies, entry points, components, icon usage, and animation libraries. |
| `scan_assets` | Index SVG, Lottie, Rive, and image assets. SVGs are decomposed into path trees with semantic labels. |
| `auto_research_motion` | Run local source-backed motion/category research, rank implementation opportunities, and build context packs for AI coding agents. |
| `research_app_motion` | Build app-context.json and motion-map.json from routes, screens, components, assets, brand concept, flows, and motion thesis. |
| `research_state_machine_experience` | Create a page-by-page Rive-like state-machine experience spec with layers, state kinds, transitions, listeners, bindings, and codegen readiness. |
| `get_app_motion_context` | Read the current app motion context, researching the app if no context exists yet. |

## Asset lanes

| Tool | What it does |
|---|---|
| `estimate_asset_lane` | Decide whether a requested asset should use the simple host-model lane or the premium QuiverAI lane. |
| `generate_simple_svg_asset` | Return a strict host-agent SVG brief for simple assets, or ingest a supplied SVG into Motion MCP when provided. |
| `generate_premium_svg_asset` | Use QuiverAI for high-fidelity, multi-part, brand-critical SVG assets and stage the result as a reviewable diff. |
| `generate_svg_asset` | Use QuiverAI to create a structured SVG asset, charge Motion credits, and stage the file as a reviewable diff. |
| `generate_asset_batch` | Manifest-driven batch SVG generation. Premium items go through QuiverAI, simple items return host-agent briefs. Supports dryRun for a zero-cost estimate. |
| `ingest_svg_asset` | Normalize, validate, index, and stage an SVG from the user or host agent so it can receive state-machine animation. |
| `list_svg_models` | List QuiverAI SVG models with live or fallback pricing credits. |
| `estimate_motion_cost` | Estimate Motion credits before a Quiver or animation operation. |
| `feed_concept` | Teach Motion MCP the app identity and brand personality for future generations. |

## Video, image & mesh perception

| Tool | What it does |
|---|---|
| `vectorize_asset` | Use QuiverAI to convert an existing image asset into an SVG and stage it as a reviewable diff. |
| `vectorize_video` | Convert a video into a vector flipbook animation (Anim8-style video-to-SVG, fully local): ffmpeg extracts frames, median-cut quantization and contour tracing build layered SVG keyframes, temporal reduction collapses identical frames. When cross-frame tracking finds multiple parts with motion, an inferred SceneDoc rig is attached and returned as a reviewable rigProposal; degenerate tracking stays pure flipbook and says why. Stages an indexed, playable SceneDoc asset as a reviewable diff. |
| `motion_to_curves` | Turn tracked part trajectories (e.g. from vectorize_video's cross-frame tracking) into eased translateX/translateY motion over persistent per-part layers: an indexed playable SceneDoc plus a standalone animated SVG preview, staged as a reviewable diff. Offsets are relative to each part's base pose; throws on degenerate input instead of staging an empty clip. |
| `perceive_image` | Raster perception (PNG): quantize, trace connected paint regions, and emit a layered SVG whose regions are named reviewable parts — then run the same anatomy detection + auto-rigger used for authored SVGs. Returns a rig PROPOSAL plus the staged SVG; nothing is committed. |
| `perceive_3d` | glTF 2.0 skeleton proposals: skinned meshes yield their exact joint hierarchy (names preserved, XY-projected origins) with per-joint weight statistics from JOINTS_0/WEIGHTS_0; unskinned static meshes get an inferred band chain along the longest axis. Stages a proposal JSON — FBX/OBJ and binary .glb are not supported yet. |

## Rigging

| Tool | What it does |
|---|---|
| `analyze_svg_anatomy` | Species-aware anatomy analysis for an SVG character: detects parts by name or geometry, matches species schemas (human-biped, avian-crow), and reports which actions (blink/wave/flap/caw) the anatomy supports. |
| `resolve_anatomy_action` | Resolve a semantic action against an SVG's detected anatomy, or queue a full timeline; returns per-node controller steps (scaleY/rotate/translate with node ids) that host code can turn directly into animation. |
| `propose_rig` | Perception seam: analyze any indexed SVG (or raw source) and return a rig PROPOSAL — species match, bones, IK chains, secondary motion, capabilities, suggested states — without persisting anything. Review it, then call rig_asset to commit. |
| `rig_asset` | Auto-rig an indexed SVG asset (or raw SVG) into a SceneDoc character rig: bones from detected anatomy, an eye look-at IK chain, and ambient secondary motion (breathe/blink/sway/spring). Every asset receives life — species schemas cover bipeds, birds, quadrupeds, insects, vehicles, and a universal blob fallback. |
| `list_rig_capabilities` | List every species schema the auto-rigger supports (expected parts and resolvable actions per species), including the universal blob fallback that guarantees any SVG can breathe and wobble. |

## Import bridges

| Tool | What it does |
|---|---|
| `import_figma_scene` | Figma bridge: ingest a snapshot JSON exported by the figma-bridge plugin (apps/figma-bridge) and synthesize a SceneDoc state machine — each connected frame becomes a state, prototype reactions become smart-animate transitions with real easing/duration. Staged as a playable, reviewable diff. |
| `import_riv` | Migration wedge from Rive: validates a .riv binary, extracts its content inventory (objects, names, type histogram) per the public format spec, indexes the asset, and stages a SceneDoc skeleton + full report under .motion-mcp/riv-imports/. |

## Planning

| Tool | What it does |
|---|---|
| `plan_screen_motion` | Return the highest-leverage motion opportunities for a screen or flow from the app motion map. |
| `plan_microinteractions` | Rank codebase-aware animation opportunities with premium scores and credit estimates. |

## Generate & bind

| Tool | What it does |
|---|---|
| `generate_animation` | Generate a reviewable diff for one approved plan item. Does not apply changes until apply_motion_diff is called. |
| `generate_motion_from_prompt` | Generation engine: parse a motion prompt with a deterministic lexicon (bounce/spin/shake/pulse/nod/wave/jump/sway/blink/slide + speed/intensity/direction/loop modifiers), synthesize temperament-driven keyframes procedurally (easing, overshoot, squash-and-stretch, stagger all derive from the temperament axes), assemble a state machine, and self-check (schema validation + structural critique + curve lint) BEFORE returning. Stages the SceneDoc — nothing commits. |
| `bind_motion_to_state` | Bind an animation to real app state (Rive-like data binding): persists a typed property binding for a component. Properties with error/loading/success semantics automatically drive the matching machine input in generated React code (e.g. hasError → error shake, isLoading → active emphasis, isSuccess → reward pop). |
| `list_motion_bindings` | List persisted data-binding properties for one component (or every component) and the MotionEvents they drive. |
| `apply_temperament` | Ensoulment primitive: resolve a named preset (calm/energetic/nervous/playful/precise/heavy) or explicit energy/weight/warmth/precision axes into a motion profile, then deterministically rewrite scene timing and easing to match. Stages the tempered SceneDoc for review. |
| `animate_app_life` | App-wide ambient-life sweep: gives every indexed SVG asset a living idle presence (breathe/hover/press plus blink, wobble, or reward-pop when anatomy supports it), auto-rigging characters along the way. All generated code is staged into ONE reviewable diff — nothing applies until apply_motion_diff. |
| `ensoul_asset` | The closed loop, one call: perceive → generate → verify → repair → preview. Give it ANY asset — raw or indexed SVG, raster PNG (perceived into paint-region parts first), or glTF mesh (skeleton proposal) — plus an optional motion prompt and temperament. Returns a stage-by-stage receipt with staged SceneDoc, rig proposals, and a GIF preview when a raster source exists. Nothing commits without review. |

## Verify & repair

| Tool | What it does |
|---|---|
| `review_animation` | Self-verifying quality loop: critiques an asset's compiled scene on two tracks — deterministic structural checks (key order, value bounds, loop seams, micro-jitter, reduced-motion safety) plus a headless render check (static/blank frames) — and returns a scored report with actionable fixes. Run it after generate_animation and before apply_motion_diff. |
| `lint_motion_curves` | Motion-curve linter over a component's compiled scene: flags mechanical linear easing on long segments and velocity discontinuities that pop on screen. Pure math, no rendering. Rubric-driven thresholds come from .motion-mcp/rubric.json. |
| `judge_against_reference` | Vision-judge pass: headless-renders the state to frames and scores aliveness 0-100 against the rubric threshold. Default provider is deterministic mock heuristics; gemini/claude providers plug in via rubric.judge.provider once wired. |
| `verify_cross_runtime` | Export parity check: bakes one state through BOTH renderable targets (animated SVG + Lottie JSON) and verifies every motion stop time survived per property bucket, with per-target mismatch reports and a score. Catches exporter drift before shipping. Structural by design — pixel-level cross-rendering needs a headless Lottie player (roadmap). Codegen parity across React/RN/Flutter/Unity remains pinned separately by the conformance harness. |
| `auto_repair` | Closed verification-and-repair loop: critique (structural + curve lint + headless render + vision judge) then apply rubric-allowed mechanical fixes segment by segment, re-critique, up to N attempts. Returns the attempt ledger and remaining issues for the host agent. |

## Preview & ship

| Tool | What it does |
|---|---|
| `preview_animation` | Return local preview metadata plus a real rendered frame snapshot for a generated diff. |
| `render_preview` | Headlessly render a component's state to an animated GIF preview (base64) without any staged diff or browser. |
| `apply_motion_diff` | Apply a generated diff to the project and run validation when possible. |
| `export_animation` | Export an asset's compiled SceneDoc as Lottie JSON or a self-contained animated SVG. Requires research_state_machine_experience to have run. |
| `export_asset` | Delivery loop: bake a component's compiled state into animated SVG, Lottie JSON, GIF, or MP4/WebM. Auto-selects the format from the stated destination (with graceful fallback), or pass an explicit format. Writes under .motion-mcp/exports/. |
| `capture_gif` | Render a SceneDoc state to an animated GIF (no browser — headless SVG rasterization via resvg). Requires research_state_machine_experience; installs @resvg/resvg-js on first use if missing. |
| `capture_video` | Render a SceneDoc state to MP4 (H.264) or WebM (VP9) via system ffmpeg on top of the same headless frame pipeline as capture_gif. |

## Utility

| Tool | What it does |
|---|---|
| `curate_workout` | Compose a deterministic workout plan from the exercise catalog: balanced moves, no consecutive repeats, mobility cool-down at the end. Returns ordered steps with durations that sum exactly to the requested budget. |
| `motion_docs_search` | Grounding search over motion-mcp's own documentation: SceneDoc schema, v1 extension contract (temperament, converters, rig weights), architecture, and the critic rubric. Use before calling generation tools so inputs stay schema-valid. |
| `get_credit_balance` | Read the current Motion MCP credit balance. |
| `purchase_credits_url` | Return the checkout URL for buying more credits. |
