# Tars server — production image. Multi-stage: build the whole pnpm workspace, then ship
# a slim runtime that runs the built server. Debian slim (glibc) rather than Alpine so the
# native `pg`/embedding paths behave. See deploy/cloud/ for how this is composed & run.

# ---- build ------------------------------------------------------------------
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Install with a warm store cache. Copy manifests first for layer caching, then the rest.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile

# Build the workspace (tsc -b via project references).
COPY . .
RUN pnpm build

# ---- runtime ----------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Copy the built workspace. Migration .sql files resolve from source-relative paths
# (packages/*/migrations) at runtime, so the whole tree must be present — not just dist/.
COPY --from=build /app /app

# Drop privileges: the base image ships an unprivileged `node` user.
USER node

# Loopback (no-auth) 8787 stays inside the container and is never published.
# Public (OAuth) 8788 is published to the host's loopback only; Tailscale Serve fronts it.
EXPOSE 8788

# The server auto-migrates (core + OAuth) on boot before listening.
CMD ["node", "packages/server/dist/main.js"]
