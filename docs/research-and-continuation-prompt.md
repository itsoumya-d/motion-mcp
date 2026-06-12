# Motion MCP Research And Continuation Prompt

Date: 2026-06-09

## Verdict

The idea is worth building, but the wedge must stay narrow: do not build another Rive/Lottie editor. Build a codebase-aware motion layer for AI coding agents that scans an existing app, identifies high-leverage motion opportunities, and emits framework-native interaction code against the assets and widgets already in the repo.

The current `motion-mcp` repo already has the right skeleton: MCP tools, scanner, asset indexer, planner, emitters, local credits, staged diffs, examples, and a Codex plugin manifest. The next phase should harden the product into a demo-quality loop.

## Current Market Notes

- Remotion proves the model of programmatic visual composition: React components become frame-accurate video output using concepts like compositions, current frame, interpolation, and spring motion.
- Rive has an MCP integration, but it connects AI tools to the Rive Editor and requires the editor to be open. It is editor-native, not repo-native.
- LottieFiles Creator MCP lets agents create and edit Lottie animations in Lottie Creator. It is also editor/workflow-native, not primarily codebase-native.
- Motion.dev AI Kit gives agents Motion docs, skills, transition editing, CSS spring generation, and animation audit capabilities. It is closest to the idea, but it is centered on Motion/Framer Motion for web.
- QuiverAI is strategically important because it generates structured SVG and explicitly positions vector graphics as animation-ready, structured components. Treat Quiver as a likely upstream asset source or partner, not as the main thing to compete against.

Useful sources:

- Remotion fundamentals: https://www.remotion.dev/docs/the-fundamentals
- Remotion interpolate: https://www.remotion.dev/docs/interpolate
- Rive MCP integration: https://rive.app/docs/editor/mcp/integration
- Lottie Creator MCP: https://docs.lottiefiles.com/en/creator/13_ai-tools/lottie-creator-mcp
- Motion AI Kit: https://motion.dev/docs/ai-kit-install
- QuiverAI a16z announcement: https://a16z.com/announcement/investing-in-quiverai/
- QuiverAI pricing: https://quiver.ai/pricing/

## Positioning

Motion MCP is:

> The AI-native motion layer for existing apps. Codex, Claude Code, or Cursor can scan your real codebase, learn your brand/assets, propose premium interactions, and generate validated framework-native animation code without replacing your components.

It should feel like "Remotion-level programmable motion, Product Design-level taste, Rive/Lottie-level liveliness, but delivered directly into an app repo."

## Non-Negotiables

1. Work with the existing codebase first. Never scaffold a new app unless the user asks.
2. Preserve existing widgets, screens, assets, tokens, and routes by default.
3. Stage every generated animation as a diff before applying it.
4. Use the host framework's native runtime: Framer Motion/GSAP for React, Reanimated plus react-native-svg for Expo/RN, AnimationController/CustomPainter/Rive for Flutter, DOTween/Animator/Rive for Unity.
5. Use Rive/Lottie/Quiver as upstream or fallback assets, not as the primary runtime for every case.
6. Validate before claiming success: typecheck/build/analyze plus visual preview where possible.
7. Respect reduced motion and accessibility.
8. Charge credits only for artifact-producing work.

## Next Build Prompt For Codex Or Claude Code

```text
You are continuing an existing repo at /Users/soumyadebnath16/Developer/mcp app/motion-mcp.

Goal: turn Motion MCP from a scaffold into a demo-ready AI-native motion plugin for Codex/Claude Code/Cursor. Do not reinitialize the repository. Do not replace the architecture. Harden the existing code.

Product definition:
Motion MCP scans an existing app/website/game, indexes SVG/Lottie/Rive/image assets and UI components, asks the user which premium micro-interactions to generate, then creates framework-native animation code as reviewable diffs. It must use existing assets and widgets first. It should make the product feel premium without rebuilding the product.

Current repo facts:
- packages/mcp-server already exposes scan_codebase, scan_assets, feed_concept, plan_microinteractions, generate_animation, preview_animation, apply_motion_diff, get_credit_balance, and purchase_credits_url.
- packages/codebase-scanner detects frameworks and component files.
- packages/asset-indexer parses SVG structure.
- packages/motion-planner ranks motion opportunities.
- emitters exist for React, React Native, Flutter, and Unity, but React is the main MVP path.
- credits-ledger is local JSON for now.
- .codex-plugin/plugin.json and .mcp.json already exist.

Your first milestone:
Make the Next.js demo loop real:
scan -> plan -> generate -> preview -> apply -> validate against examples/next-app.

Work plan:
1. Read README.md, docs/architecture.md, and all package source files before editing.
2. Fix local execution/build issues first. The current machine has had Node/pnpm hangs, so diagnose carefully and document the exact working command.
3. Improve React generation so it can patch a real Next.js component import/use site, not only create a generated file under .motion-mcp/generated.
4. Keep generated changes additive and reversible. If modifying a source component, preserve layout and props.
5. Make preview_animation produce useful preview metadata for the Next.js example. Prefer a local route or generated preview component over a JSON-only file URL.
6. Add validator behavior that runs the target project's safest available command and reports clear stdout/stderr.
7. Add at least one focused test or fixture check for scanner, asset indexer, planner, and React emitter.
8. Update README with the verified demo commands.

Quality rules:
- Do not invent a custom runtime.
- Do not animate every component automatically.
- Do not apply changes until a diff is selected.
- Do not use paid/cloud APIs yet. Keep semantic labeling heuristic/local for MVP.
- Include reduced-motion handling in generated React components.
- Prefer existing dependencies; ask before adding new ones.

Acceptance criteria:
- From the repo root, a user can run the MCP or HTTP bridge, scan examples/next-app, get a motion plan, generate a React animation for public/logo.svg or the landing CTA, apply it, and run validation.
- The generated UI uses the existing example app/assets and visibly adds motion without replacing the page.
- README contains the exact commands and expected tool call sequence.
```

## Build Order After The Demo

1. React/Next patcher and preview.
2. Expo/Reanimated emitter that uses actual SVG path data instead of placeholder heart geometry.
3. Credit ledger backed by Supabase and Stripe.
4. Quiver upstream integration for new structured SVG generation.
5. Rive/Lottie Creator integrations as optional fallback/export tools.
6. Flutter and Unity only after the React/Expo wedge proves demand.
