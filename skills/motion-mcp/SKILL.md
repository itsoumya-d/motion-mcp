---
name: motion-mcp
description: Use Motion MCP to research app flow, create Rive-like page state-machine experience specs, choose simple or premium SVG generation lanes, generate or ingest structured SVGs, plan premium micro-interactions, generate state-machine animation code, preview diffs, and apply approved motion changes.
---

# Motion MCP

Use this skill when the user wants to add premium motion, animated SVGs, Rive/Lottie-style interactivity, micro-interactions, or codebase-aware animation to an existing app, website, mobile app, or game.

## Workflow

1. Run `scan_codebase` on the target project root.
2. Run `scan_assets` to inventory SVG, Lottie, Rive, and image assets.
3. If the project identity matters, call `feed_concept` with the logo and brand concept.
4. Call `auto_research_motion` when the user asks for best-in-category, research-backed, cross-platform, Rive/Lottie replacement, or context-engineered recommendations.
5. Call `research_app_motion` with the user's brief to build `.motion-mcp/app-context.json` and `.motion-mcp/motion-map.json`.
6. Call `research_state_machine_experience` when the user asks for Rive-like behavior across pages, state-machine depth, or page-by-page interaction design.
7. Call `plan_screen_motion` for the relevant screen or flow and show the top high-leverage moments.
8. For a needed asset, call `estimate_asset_lane`.
9. If the lane is simple, call `generate_simple_svg_asset` without SVG first, generate the SVG with the host coding model from the returned strict prompt, then call `ingest_svg_asset`.
10. If the lane is premium, call `list_svg_models`, `estimate_motion_cost`, then `generate_premium_svg_asset`. Use `vectorize_asset` for existing raster assets.
11. Call `generate_animation` for the approved asset or plan item.
12. Run `preview_animation` and summarize the diff.
13. Call `apply_motion_diff` only after approval.

## Principles

- Preserve the existing app and design system.
- Use `auto_research_motion` to turn source-backed patterns into ranked local opportunities and context packs before broad implementation.
- Prefer the project's existing animation library.
- Generate framework-native code, not a new runtime.
- Use the simple host-model lane for compact icons, loaders, badges, decorative marks, and quick Lottie-like SVGs.
- Use QuiverAI as the premium structured SVG provider, with the API key kept server-side.
- Use host-code state machines for Rive-like states: idle, hover, pressed, active, success, error, disabled.
- Use `research_state_machine_experience` before broad implementation so every page has a Rive-like spec with layers, transitions, conditions, listeners, and codegen readiness.
- Bind animation to app state through ViewModel-style properties such as `isLoading`, `progress`, `count`, `isSelected`, `hasError`, `themeColor`, `avatarImage`, and `rewardLevel`.
- Respect reduced motion preferences.
- Keep changes reviewable and reversible.
