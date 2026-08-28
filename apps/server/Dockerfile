# syntax=docker/dockerfile:1

FROM oven/bun:1.4.0 AS bun

FROM node:26-bookworm AS build

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY packages/open-flow/package.json packages/open-flow/package.json
RUN bun install --frozen-lockfile

COPY . .
RUN bun run --filter @oomol-lab/open-flow-server build

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production \
  OPEN_FLOW_DATA_DIR=/data/open-flow \
  OPEN_FLOW_HOST=0.0.0.0 \
  OPEN_FLOW_PORT=3000

WORKDIR /app
COPY --from=build /workspace/apps/server/dist/ ./
RUN mkdir -p /data/open-flow

VOLUME ["/data/open-flow"]
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.OPEN_FLOW_PORT ?? 3000}/healthz`).then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "--no-node-snapshot", "server/main.js"]
