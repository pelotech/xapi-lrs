# ==============================================================================
# xapi-lrs — Multi-stage Docker build
#
# TypeScript source is compiled to JavaScript using tsc during the build stage.
#
# Base images are the official Node.js Debian slim images. They run as root by
# default; the runtime stage switches to the image's `node` user (uid 1000).
# The image ships no corepack or pnpm, so the deps stage installs corepack,
# which honours the packageManager field in package.json.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Install ALL dependencies (dev + prod) for the build stage
# ------------------------------------------------------------------------------
FROM node:26.6.0-trixie-slim AS deps

ENV CI=true

WORKDIR /app

RUN npm install -g corepack && corepack enable

# pnpm-workspace.yaml carries the overrides (pnpm 11 no longer reads the `pnpm`
# field in package.json). Omitting it here makes the config disagree with the
# lockfile and --frozen-lockfile fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY --chown=1000:1000 package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------
# Stage 2: Compile TS → JS with tsc
# ------------------------------------------------------------------------------
FROM deps AS build

COPY --chown=1000:1000 tsconfig.json tsconfig.build.json ./
COPY --chown=1000:1000 src/ src/

RUN pnpm run build

# ------------------------------------------------------------------------------
# Stage 3: Production-only dependencies
# ------------------------------------------------------------------------------
FROM deps AS prod-deps

RUN pnpm install --frozen-lockfile --prod

# ------------------------------------------------------------------------------
# Stage 4: Runtime
# ------------------------------------------------------------------------------
FROM node:26.6.0-trixie-slim AS runtime

WORKDIR /app

COPY --chown=1000:1000 package.json ./

COPY --from=prod-deps --chown=1000:1000 /app/node_modules node_modules
COPY --from=build --chown=1000:1000 /app/dist dist
COPY --chown=1000:1000 db/ db/

EXPOSE 8081 8091

# The official image defaults to root; run as its `node` user.
USER 1000

# The base image's docker-entrypoint.sh prepends `node` only when the first
# argument isn't an executable, so this CMD and the migration override below
# both pass through unchanged.
#
# Override CMD to run migrations standalone:
#   docker run xapi-lrs node dist/migrate.js
CMD ["node", "dist/server.js"]
