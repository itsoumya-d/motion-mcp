# Contributing to Motion MCP

Thanks for helping make coding-agent-native motion real. This repo moves fast;
these are the ground rules.

## Development loop

```bash
pnpm install
pnpm build        # tsc across all workspace packages
pnpm typecheck    # --noEmit pass over the same graph
pnpm test         # node:test via tsx — 213 tests, no Jest config needed
python3 -m unittest discover -s pipeline/tests   # offline bake pipeline (Python)
```

The full gate must pass before any PR merges. CI runs the Node matrix
(20/22 × ubuntu/macos) on every push.

## Ground rules

1. **Determinism is a feature.** Generation paths must produce identical
   output for identical input — seed ids from content (`stableId`), never from
   wall clocks. Timestamps belong in metadata fields only.
2. **Nothing commits without review.** Every mutation of a user's project goes
   through staged diffs and `apply_motion_diff`. New tools must follow that
   contract.
3. **Honest scope.** If a capability degrades or fails, return *why* in the
   receipt instead of pretending success. README claims must match reality —
   test/tool counts included.
4. **No new runtime deps** without discussion; prefer extending existing
   packages. Workspace packages depend on each other via `workspace:*`.
5. **TypeScript strictness.** No `any` in public APIs; narrow at boundaries
   (see `motion-curves.ts` receipts as an example).

## Adding an MCP tool

1. Implement the engine in the owning package (e.g. `@motion-mcp/vectorizer`)
   with unit tests under `tests/`.
2. Register it in `packages/mcp-server/src/index.ts` with a zod `inputSchema`
   and a description written for agents: say what it stages, what it returns,
   and what to run next.
3. Charge credits via `consumeCredits` with a stable reason string.
4. Add the tool to `skills/motion-mcp/SKILL.md` where it fits the workflow.
5. Update the README tool count honestly.

## Releases

Versions live per package. Cutting a release:

```bash
# bump versions, update CHANGELOG.md, then:
git tag vX.Y.Z && git push origin main --tags
```

The tag triggers `.github/workflows/release.yml`: build → typecheck → test →
`npm publish --provenance` for every workspace package → GitHub release notes.
You need the `NPM_TOKEN` secret configured once.

## Reporting bugs

Open a GitHub issue with the exact tool call, the receipt JSON, and what you
expected. Security issues go through [SECURITY.md](./SECURITY.md) instead.
