# Getting started with Motion MCP

From zero to a verified, reviewable animation inside your existing app —
about ten minutes.

## 0. What you need

- Node.js 20+ and pnpm 9
- A project you want to animate (React/Next, React Native/Expo, Flutter, or Unity)
- Optional: `ffmpeg` on PATH for video tools (`vectorize_video`, `capture_video`)

## 1. Build and connect

```bash
git clone https://github.com/itsoumya-d/motion-mcp.git
cd motion-mcp && pnpm install && pnpm build
```

Point your coding agent at the built server (adjust paths):

**Claude Code**
```bash
claude mcp add motion-mcp -- node /absolute/path/to/motion-mcp/packages/mcp-server/dist/index.js
```

**Codex CLI** (`~/.codex/config.toml`)
```toml
[mcp_servers.motion-mcp]
command = "node"
args = ["/absolute/path/to/motion-mcp/packages/mcp-server/dist/index.js"]
```

**Cursor / Windsurf / Claude Desktop**: same command in their MCP config.

Optional environment (see [.env.example](../.env.example)): QuiverAI keys for
the premium asset lane, `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` for live vision
judging, `MOTION_MCP_HTTP_PORT` to expose the HTTP tool bridge.

## 2. Let it understand your app

Ask your agent:

> Scan my codebase, research how this app should move, and show me the
> highest-leverage motion moments.

That runs `scan_codebase` → `research_app_motion` → `plan_screen_motion`,
writing `.motion-mcp/app-context.json` and `.motion-mcp/motion-map.json`.
Nothing is modified yet — these are read-only passes over your source.

## 3. Generate an asset (pick one lane)

- **Simple lane** — `generate_simple_svg_asset` returns a strict SVG brief;
  your host model draws it; `ingest_svg_asset` stages it.
- **Premium lane** — `generate_premium_svg_asset` calls QuiverAI for
  structured SVG.
- **Video** — `vectorize_video` turns an mp4 into a vector flipbook (fully
  local); smooth translations can become eased tracks via `motion_to_curves`.

## 4. Animate, verify, repair

```text
generate_animation   → compiles SceneDoc → framework-native code as a staged diff
review_animation     → deterministic critique + rendered-frame checks
lint_motion_curves   → flags mechanical easing / velocity pops
auto_repair          → loops scoped fixes until pass or N attempts
preview_animation    → rendered snapshots of the staged diff
```

The loop is: generate → review → (repair) → until the report is clean.

## 5. Bind it to real state and ship

`bind_motion_to_state` wires machine inputs to properties detected in *your*
source (`isLoading`, `progress`, …). Then — only after you approve:

```text
apply_motion_diff    → applies the staged files via AST-patched imports
```

Every change lands as normal code in your repo — review it in git like
anything else. Full tool catalog: [tool-reference.md](./tool-reference.md).
Format details: [scenedoc-spec.md](./scenedoc-spec.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ffmpeg not found` | Install ffmpeg; video tools skip gracefully without it |
| Premium lane errors | Set `QUIVERAI_API_KEY` or stay on the simple/video lanes |
| Judge always "mock" | Live judging needs `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`; offline mock is the default |
| Bridge 401 over HTTP | Set `MOTION_MCP_HTTP_TOKEN` on the server and send `Authorization: Bearer <token>` |
| Insufficient credits error | Workspace ledger at `.motion-mcp/credits.json`; grant via env `MOTION_MCP_INITIAL_CREDITS` |
