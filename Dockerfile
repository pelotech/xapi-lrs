# ==============================================================================
# xapi-lrs — Multi-stage Docker build
#
# TypeScript source is compiled to JavaScript using tsc during the build stage.
# Runtime image uses plain `node` with only production dependencies.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Install ALL dependencies (dev + prod) for the build stage
# ------------------------------------------------------------------------------
FROM node:24.18.0-slim AS deps

ENV CI=true
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------
# Stage 2: Compile TS → JS with tsc
# ------------------------------------------------------------------------------
FROM deps AS build

COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/

RUN pnpm run build

# ------------------------------------------------------------------------------
# Stage 3: Production-only dependencies
# ------------------------------------------------------------------------------
FROM deps AS prod-deps

RUN pnpm install --frozen-lockfile --prod

# ------------------------------------------------------------------------------
# Stage 4: Runtime
# ------------------------------------------------------------------------------
FROM node:24.18.0-slim AS runtime

WORKDIR /app

COPY package.json ./

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY db/ db/

EXPOSE 8081 8091

USER node

# Override CMD to run migrations standalone:
#   docker run xapi-lrs node dist/migrate.js
CMD ["node", "dist/server.js"]
