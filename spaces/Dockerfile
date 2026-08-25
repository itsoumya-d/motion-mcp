# Motion MCP on Hugging Face Spaces: a free public hosted endpoint.
#
# The Space exposes the HTTP bridge (`/tool/<name>`) plus MCP discovery at
# `/.well-known/mcp` so any coding agent can reach Motion MCP without a local
# install. Set MOTION_MCP_HTTP_TOKEN as a Space secret before making the Space
# public — the bridge refuses to start wide open on 0.0.0.0 without one.

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pnpm via corepack (repo pins pnpm@9.15.0 in packageManager).
RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @motion-mcp/server... build \
    && pnpm prune --prod

ENV NODE_ENV=production \
    MOTION_MCP_HTTP_PORT=7860 \
    MOTION_MCP_HTTP_HOST=0.0.0.0

EXPOSE 7860

CMD ["node", "packages/mcp-server/dist/index.js"]
