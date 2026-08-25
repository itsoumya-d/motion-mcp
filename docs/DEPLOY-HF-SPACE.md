# Deploy Motion MCP as a Hugging Face Space (free hosted endpoint)

The Space gives you a **public HTTPS Motion MCP endpoint** — no server, no
domain, no TLS. Coding agents reach the HTTP tool bridge at
`https://<org>-motion-mcp.hf.space/tool/<tool>`, discovery lives at
`/.well-known/mcp`, and liveness at `/health`.

## 1. Create the Space

```bash
hf auth login
hf repo create <your-org>/motion-mcp --repo-type space --space_sdk docker
```

## 2. Push the Space files

From this repository's root:

```bash
hf upload <your-org>/motion-mcp spaces/Dockerfile Dockerfile --repo-type space
hf upload <your-org>/motion-mcp packages packages --repo-type space
hf upload <your-org>/motion-mcp pnpm-workspace.yaml pnpm-workspace.yaml --repo-type space
hf upload <your-org>/motion-mcp pnpm-lock.yaml pnpm-lock.yaml --repo-type space
hf upload <your-org>/motion-mcp package.json package.json --repo-type space
hf upload <your-org>/motion-mcp tsconfig.base.json tsconfig.base.json --repo-type space
```

## 3. Set a token before going public

The bridge binds `0.0.0.0` inside the Space, so it requires a bearer token:

```bash
openssl rand -hex 32   # keep this — clients send it as the API key
hf spaces secrets set <your-org>/motion-mcp MOTION_MCP_HTTP_TOKEN=<value>
```

Every `/tool/<name>` call must then carry `Authorization: Bearer <value>`.
Requests without it get 401; abuse gets 429 (60 req/min per client by
default — tune with the `MOTION_MCP_HTTP_RATE_LIMIT_PER_MIN` secret).

## 4. Verify

```bash
curl -s "https://<org>-motion-mcp.hf.space/health"
curl -s "https://<org>-motion-mcp.hf.space/.well-known/mcp" | jq '.serverInfo'
curl -s -X POST "https://<org>-motion-mcp.hf.space/tool/list_rig_capabilities" \
    -H "Authorization: Bearer $MOTION_MCP_HTTP_TOKEN" | jq 'keys'
```

## 5. Point your coding agent at it

**Codex CLI** (`~/.codex/config.toml`) and Claude Desktop/Cursor custom
connector:

```json
{ "type": "url", "url": "https://<org>-motion-mcp.hf.space", "headers": { "Authorization": "Bearer <token>" } }
```

Or use the bridge through any HTTP-capable MCP shim; local stdio remains the
primary transport (`claude mcp add motion-mcp -- npx ... ./dist/index.js`).

## Notes

- The Space builds from source on push (~3 min first build); restarts reuse
  the cached image.
- Generated artifacts live inside the container's ephemeral filesystem; mount
  a persistent Space volume if you want staged diffs to survive restarts.
- ffmpeg is baked into the image so `vectorize_video` / `capture_gif` work.
