# ==============================================================================
# xapi-lrs — Multi-stage Docker build
#
# TypeScript source is compiled to JavaScript using tsc during the build stage.
#
# Base images are Minimus hardened Node (reg.mini.dev/node-fips), whose FIPS
# variant runs OpenSSL's FIPS provider with `default_properties = fips=yes`, so
# node reports crypto.getFips() === 1 with no runtime flag. Two consequences
# worth knowing before editing this file:
#
#   * MD5 throws (`digital envelope routines::unsupported`). Nothing in this
#     app hashes with MD5 — helpers/etag.ts uses SHA-1 and attachment digests
#     use SHA-256, both of which the FIPS provider allows — but node-postgres
#     computes MD5 for `AuthenticationMD5Password`, so the DATABASE MUST USE
#     scram-sha-256 (the PostgreSQL 14+ default). md5 password auth is not
#     FIPS-compliant anyway; see the README.
#   * The FIPS provider restricts TLS groups to the NIST curves, which can
#     affect outbound TLS to endpoints offering only x25519.
#
# The `-dev` tag is the builder variant (shell, apk, git, corepack, pnpm); the
# untagged-variant runtime image drops those. Both already run as uid 1000 with
# WORKDIR /app, so COPY needs --chown to keep the app dir writable by that uid.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Install ALL dependencies (dev + prod) for the build stage
# ------------------------------------------------------------------------------
FROM reg.mini.dev/node-fips:24.18.0-dev AS deps

ENV CI=true

WORKDIR /app

# No corepack step: the -dev image ships pnpm, which honours the packageManager
# field in package.json and self-switches to the pinned version.
#
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
FROM reg.mini.dev/node-fips:24.18.0 AS runtime

WORKDIR /app

COPY --chown=1000:1000 package.json ./

COPY --from=prod-deps --chown=1000:1000 /app/node_modules node_modules
COPY --from=build --chown=1000:1000 /app/dist dist
COPY --chown=1000:1000 db/ db/

EXPOSE 8081 8091

# Already the image default; stated explicitly so a base-image change can't
# silently promote this to root.
USER 1000

# The base image's docker-entrypoint.sh is the stock node one (it prepends
# `node` only when the first argument isn't an executable), so this CMD and the
# migration override below both pass through unchanged.
#
# Override CMD to run migrations standalone:
#   docker run xapi-lrs node dist/migrate.js
CMD ["node", "dist/server.js"]
