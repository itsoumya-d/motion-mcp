# Security Policy

## Reporting a vulnerability

Email **admin@otaitech.com** with `motion-mcp` in the subject line, or open a
GitHub Security Advisory on this repository. Please include reproduction steps
and affected versions. We aim to acknowledge reports within 7 days.

Do not report secrets leakage through public issues.

## Threat model — read before hosting

Motion MCP is a local-first tool: it reads your codebase, writes only inside
the project's `.motion-mcp/` directory, and stages every change as a reviewable
diff that applies solely after explicit approval (`apply_motion_diff`).

- **Codebase access.** Tools like `scan_codebase` and `research_app_motion`
  read repository source to bind motion to real app state. Run the server only
  against projects you trust.
- **HTTP bridge.** The optional HTTP bridge (enable with
  `MOTION_MCP_HTTP_PORT`) is bound to `127.0.0.1` by default. If you expose it:
  - set `MOTION_MCP_HTTP_TOKEN` (constant-time-checked bearer token) — the
    server logs a loud warning if you bind beyond localhost without one;
  - tune `MOTION_MCP_HTTP_RATE_LIMIT_PER_MIN` for your environment;
  - request bodies are capped at 1 MB.
- **API keys.** `QUIVERAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`
  stay in the server's process environment and are never sent back through
  tool results or written into `.motion-mcp/`. Provide keys via env vars, never
  via chat context.
- **Premium lane / judge calls.** Enabling the QuiverAI lane or live vision
  judging sends asset content and rendered frames to those third-party APIs.
  The deterministic offline mock keeps everything local when unset.
- **Generated code.** Emitted React/RN/Flutter/Unity files land as staged
  diffs. Review them like any other PR before applying.

## Supported versions

| Version | Supported |
|---|---|
| latest `main` | yes |
| tagged releases | security fixes only |
