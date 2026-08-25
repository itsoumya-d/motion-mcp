# Changelog

All notable changes to Motion MCP are documented here. Versions follow
semver per workspace package; the server package (`@motion-mcp/server`,
bin `motion-mcp`) leads the version line.

## 0.1.0 — 2026-08-24

Initial public milestone: the verification-first release.

- **52 MCP tools** over stdio (+ optional HTTP tool bridge): codebase and
  asset scanning, app-motion research, state-machine experience specs, asset
  lanes (simple host-model / premium QuiverAI / video vectorization), SceneDoc
  scene graph with additive v1 extensions (temperament, bindings, bone
  weights), native emitters for React/Next, React Native/Expo, Flutter (β),
  Unity (β), AST import patching, Lottie + animated-SVG exporters.
- **`ensoul_asset`**: perceive → generate → verify → repair → preview in one
  call over SVG, PNG, or glTF inputs; stage-by-stage receipt; nothing applies
  without review.
- **Closed quality loop**: live vision judging (Gemini/Claude or deterministic
  mock), rubric-as-config (`.motion-mcp/rubric.json`), motion-curve linter,
  iterative segment-scoped auto-repair with full attempt ledger.
- **Perception & generation engines**: PNG paint-region parts → rig proposals;
  glTF skins → exact joint hierarchies; NL intent lexicon × temperament axes →
  procedural synthesis.
- **Video-to-rig & motion curves**: `vectorize_video` flipbook tracing with
  cross-frame part tracking infers reviewable rig proposals; `motion_to_curves`
  converts tracked trajectories into eased translate tracks over persistent
  layers with deterministic diff ids.
- **Export-parity gate**: `verify_cross_runtime` proves stop-level parity
  across animated SVG and Lottie targets before shipping.
- 213 Node tests + 13 pipeline tests; hardened HTTP bridge (bearer auth,
  rate limiting, body cap); Hugging Face Spaces deployment path.
