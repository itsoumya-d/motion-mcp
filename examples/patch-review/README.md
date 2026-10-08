# Review a small, deterministic source-code patch

A credential-free demo of Motion MCP's existing `@motion-mcp/ast-patcher` package.
It runs the real implementation on a **hand-written TSX fixture**, prints the
before/after source and a review receipt, and makes no changes to a user project.
No simulated model response or live AI is involved.

## Run from a clean checkout

Prerequisites: Node.js 22 or 24 and pnpm 9.15.0 (the repository's pinned package
manager). From the repository root on a branch containing this example:

```sh
pnpm install --frozen-lockfile
pnpm demo:patch-review
pnpm test:patch-review
pnpm typecheck:patch-review
```

No `.env` file, API key, MCP client, network service, React app, or browser is
needed after dependency installation. The CLI accepts no arguments; it reads
only the bundled fixture and prints to stdout. It does not apply or save a patch.

[Expected terminal output](./expected-output.txt) is checked by the tests.
[Before](./fixtures/before.tsx.txt) and [after](./fixtures/after.tsx.txt) are
reviewable, checked-in fixtures. The `.txt` suffix is deliberate: these are
source samples, not a runnable React application. `@/ui` and `./MotionCtaMark`
are illustrative module paths, not resolved or executed by the demo.

## What the receipt demonstrates

1. Add a missing named import by inspecting TypeScript import declarations.
   Preserve the existing namespace import, aliased import, client directive,
   comments, and component body in this fixture.
2. Insert `<MotionCtaMark aria-hidden="true" />` after an explicit line anchor.
3. Repeat both operations and verify byte-for-byte identical output.
4. Request a missing anchor and return unchanged source with an explanatory note.
5. Show the existing conservative text guard: even a component-looking example
   inside a comment produces a no-op. This intentionally exposes a limitation.

The [runner](./demo.ts) imports the [existing implementation](../../packages/ast-patcher/src/index.ts)
directly. It adds no second patch engine, provider call, generated component,
MCP tool, or runtime dependency.

## Evidence and limits

The [regression tests](../../tests/patch-review-demo.test.ts) assert the complete
expected transformed source, deterministic transcript, repeated/guarded no-ops,
fixture preservation, CLI path independence, rejection of arbitrary path
arguments, and syntactic TSX parsing. The focused test command also runs the
existing five patcher tests.

This is a narrow source-transformation demonstration. Import inspection uses the
TypeScript compiler API, but insertion is string splicing; component detection
and anchor insertion use text matching, **not a JSX AST rewrite**. The helper
uses the first matching anchor and can match comments. It does not resolve
symbols or validate arbitrary aliases, type-only imports, binding collisions,
module availability, or whether an insertion is semantically appropriate.
Syntax-only parsing of the fixture does not establish compiler correctness or
runtime behavior.

The demo does not perform vulnerability detection, semantic code review, live
model inference, or production deployment. Its connection to code-review tooling
is concrete and bounded: inspect a change, make its exact output reviewable,
record a reason for no-ops, and test repeatability before considering application.

The full repository gate remains:

```sh
pnpm build
pnpm typecheck
pnpm test
python3 -m unittest discover -s pipeline/tests
```
