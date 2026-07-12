# xapi-lrs

A production-ready, xAPI 1.0.3 conformant Learning Record Store built on [Hono](https://hono.dev) + PostgreSQL (or [PGlite](https://pglite.dev) for zero-dependency local use).

## Features

- Full xAPI 1.0.3 compliance (statements, documents, agents, activities)
- Statement validation per xAPI Data spec sections 2.2-2.6 and 4.0
- Multipart/mixed attachment support
- Server-Sent Events (SSE) for real-time statement streaming
- JWT and Basic Auth (credential-based) authentication
- Admin UI with dashboard, credential management, and statement browser
- OpenTelemetry metrics (Prometheus exporter)
- PostgreSQL with pg_notify for event-driven architecture
- **PGlite mode**: run with an embedded in-process database — no PostgreSQL required
- **lrsql-compatible schema (v0.9.5)**: the bundled schema is catalog-parity with [yetanalytics/lrsql](https://github.com/yetanalytics/lrsql) v0.9.5's Postgres shape (CI-enforced — see [Taking over an lrsql database](#taking-over-an-lrsql-database)), so xapi-lrs can take over a live lrsql database in place

## Quick Start

### With PostgreSQL

```bash
# Start PostgreSQL
docker compose up -d postgres

# Install dependencies
pnpm install

# Apply database schema
pnpm db:migrate

# Start in development mode
pnpm dev
```

### Full stack via Docker Compose

```bash
pnpm docker-compose:up    # docker compose up -d (postgres + xapi-lrs)
```

The `postgres` service starts with an empty database — it no longer bundles the
schema via `docker-entrypoint-initdb.d`. The `xapi-lrs` service instead runs
with `AUTO_MIGRATE=true`, so it applies the schema itself on first boot (and is
a no-op on subsequent restarts). This is also how you'd point the compose
stack at a pre-existing (e.g. lrsql-provisioned) database: swap the `postgres`
service's connection details for the target database's and the same
`AUTO_MIGRATE` boot path performs the takeover — see
[Taking over an lrsql database](#taking-over-an-lrsql-database) below.

### With PGlite (no PostgreSQL required)

PGlite embeds a full PostgreSQL engine in-process via WASM. No external database or Docker needed.

```bash
pnpm install

# In-memory database (data lost on restart):
DATABASE_DRIVER=pglite pnpm dev

# Persistent database (data survives restarts):
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=./data/pglite pnpm dev
```

The schema is applied automatically on first start. The admin account is bootstrapped as described in [Configuration](#configuration) below.

> **Limitations of PGlite mode:**
>
> - Single connection — concurrent transactions are serialized. Suitable for local development and low-concurrency workloads; not recommended for production.
> - SSE uses in-process delivery (`db.listen`) instead of cross-process `LISTEN/NOTIFY` — works correctly within a single Node.js process.
> - `AUTO_MIGRATE` and `pnpm db:migrate` are ignored in PGlite mode (migrations are applied directly from committed SQL files).

The LRS will be available at `http://localhost:8081` and the admin server at `http://localhost:8091`.

## Taking over an lrsql database

Because xapi-lrs's bundled schema is catalog-parity with [yetanalytics/lrsql](https://github.com/yetanalytics/lrsql) v0.9.5's Postgres shape, xapi-lrs can be pointed at a live lrsql database and take it over in place — statements, actors, documents, and credentials carry over unmodified.

1. **Point xapi-lrs at the same database.** Set `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` (or `DATABASE_URL`) to the existing lrsql Postgres instance — no dump/restore needed.
2. **Run migrations against it.** `node dist/migrate.js` (or `pnpm db:migrate`, or boot with `AUTO_MIGRATE=true`). Against an already-lrsql-shaped database this is a no-op except for adding xapi-lrs's SSE `NOTIFY` trigger (`trg_xapi_statement_stored`) — the rest of the schema is already identical.
3. **Bootstrap an admin account via env vars.** lrsql admin accounts do **not** port: lrsql hashes passwords with a buddy `bcrypt+sha512$...` format that xapi-lrs's bcrypt-based `passhash` check does not (and cannot securely) verify. Existing lrsql admin logins will fail cleanly (401, not a 500) after takeover. Set `LRS_ADMIN_USER` / `LRS_ADMIN_PASSWORD` to bootstrap a fresh xapi-lrs admin account on startup (see [Configuration](#configuration)).
4. **API credentials DO port.** Existing lrsql `api_key`/`secret_key` pairs and their scopes are read as-is (`lrs_credential` / `credential_to_scope`) — statement traffic authenticated with pre-existing lrsql credentials keeps working immediately after the migration runs, with no re-issuing of keys required.

A startup schema probe runs before the server accepts traffic and fails fast if the connected database's shape doesn't match what this release expects (empty database, legacy pre-0.6 xapi-lrs schema, or anything else unrecognized), rather than surfacing later as an opaque runtime 500 (see [`src/db-probe.ts`](src/db-probe.ts)).

> **Breaking change: pre-0.6 xapi-lrs databases are not upgradable.** v0.6.0 rewrote the bundled schema to match lrsql v0.9.5's shape byte-for-byte (composite-key credential scopes, `Sub*`/positional group-member usages, explicit `timestamp`/`stored`/`registration` columns, a new scope vocabulary). Databases created by xapi-lrs pre-0.6 — PGlite data directories or Postgres databases provisioned by the old `000001` migration — use an incompatible shape and cannot be migrated forward; the startup probe detects this and refuses to boot rather than serve against a mismatched schema. Drop and re-provision: for Postgres, drop and recreate the database (or `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) and re-run migrations; for PGlite, delete the `PGLITE_DATA_DIR` directory.

## Configuration

All configuration is via environment variables. See `.env.test` for defaults.

| Variable                            | Default     | Description                                           |
| ----------------------------------- | ----------- | ----------------------------------------------------- |
| `LRS_PORT` / `PORT`                 | `8081`      | xAPI HTTP port                                        |
| `LRS_ADMIN_PORT` / `ADMIN_PORT`     | `8091`      | Admin/health/metrics port                             |
| `DATABASE_DRIVER`                   | `pg`        | Database driver: `pg` (PostgreSQL) or `pglite`        |
| `PGLITE_DATA_DIR`                   | (none)      | PGlite data directory; omit for in-memory             |
| `PGHOST`.                           | `localhost` | PostgreSQL host                                       |
| `PGPORT`                            | `5432`      | PostgreSQL port                                       |
| `PGDATABASE`                        | `xapi_lrs`  | PostgreSQL database                                   |
| `PGUSER`                            | `xapi_lrs`  | PostgreSQL user                                       |
| `PGPASSWORD`                        | (empty)     | PostgreSQL password                                   |
| `DATABASE_URL`                      | (none)      | Full connection string (overrides PG\* vars)          |
| `JWT_ISSUER`                        | (none)      | JWT issuer for token validation                       |
| `JWT_AUDIENCE`.                     | (none)      | JWT audience for token validation                     |
| `JWKS_URI`.                         | (none)      | JWKS endpoint URI                                     |
| `OIDC_DISCOVERY_URL`                | (none)      | OIDC discovery URL (auto-discovers JWKS)              |
| `LRS_ADMIN_USER`                    | (none)      | Bootstrap admin username                              |
| `LRS_ADMIN_PASSWORD`                | (none)      | Bootstrap admin password                              |
| `ADMIN_SESSION_SECRET`              | (random)    | Session secret (required in production)               |
| `LOG_LEVEL`                         | `info`      | Log level (silent/fatal/error/warn/info/debug/trace)  |
| `CORS_ORIGIN`                       | `*`         | CORS allowed origin                                   |
| `LRSQL_STMT_GET_DEFAULT`.           | `50`        | Default `GET /statements` page size when no `limit`   |
| `LRSQL_STMT_GET_MAX`.               | `50`        | Hard cap on `GET /statements` `limit` (silent clamp)  |
| `SHUTDOWN_TIMEOUT_MS`               | `30000`     | Hard deadline for graceful shutdown before exit       |
| `PG_STATEMENT_TIMEOUT_MS`           | `30000`     | Per-statement DB query timeout (`0` disables)         |
| `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS` | `60000`     | Idle-in-transaction connection timeout (`0` disables) |

### Health checks

On the admin port (`LRS_ADMIN_PORT`, default `8091`):

| Path       | Purpose                        | Returns 503 when                                                  |
| ---------- | ------------------------------ | ----------------------------------------------------------------- |
| `/healthz` | Liveness probe                 | (never, unless the process is deadlocked)                         |
| `/readyz`  | Readiness probe                | shutting down, DB unreachable, or pg_notify listener disconnected |
| `/ready`   | Deprecated alias for `/readyz` |

On SIGTERM/SIGINT the server flips `/readyz` to 503, aborts long-lived SSE streams, waits for in-flight HTTP requests, stops the pg_notify listener, drains the DB pool, and exits — with a hard `SHUTDOWN_TIMEOUT_MS` deadline as a safety net.

## Scripts

| Script                     | Description                                 |
| -------------------------- | ------------------------------------------- |
| `pnpm dev`                 | Start with hot reload (tsx watch)           |
| `pnpm build`               | Compile TypeScript to `dist/`               |
| `pnpm start`               | Run compiled output                         |
| `pnpm test`                | Run unit tests                              |
| `pnpm test:integration`    | Run integration tests (requires PostgreSQL) |
| `pnpm test:conformance`    | Run ADL conformance suite                   |
| `pnpm typecheck`           | Type-check without emitting                 |
| `pnpm lint`                | Lint with oxlint                            |
| `pnpm fmt`                 | Format with oxfmt                           |
| `pnpm db:migrate`          | Run database migrations                     |
| `pnpm docker:build`        | Build Docker image                          |
| `pnpm docker-compose:up`   | Start full stack (postgres + lrs)           |
| `pnpm docker-compose:down` | Stop the stack                              |

## Architecture

```
src/
  admin/          # Admin UI (htmx + Pico CSS)
  auth/           # JWT verification, credential auth
  helpers/        # Enrichment, ETag, SQUUID utilities
  middleware/     # Authentication & authorization middleware
  repositories/   # PostgreSQL data access (statements, documents, agents)
  routes/         # Hono route handlers (xAPI endpoints)
  sse/            # Server-Sent Events (pg_notify → SSE)
  xapi/           # Statement validator, multipart parser, signature verification
  xapi-types/     # xAPI type definitions
  app.ts          # Hono app factory
  config.ts       # Environment-driven config with Zod validation
  db.ts           # PostgreSQL pool management
  server.ts       # Process entrypoint
```

## Supply Chain

Container images published to `ghcr.io/pelotech/xapi-lrs` are signed with [Sigstore cosign](https://docs.sigstore.dev/) (keyless / OIDC) and carry SLSA build provenance attestations. Release images additionally have SPDX and CycloneDX SBOMs attached as Sigstore attestations and as downloadable release artifacts.

Verify an image (substitute the tag):

```bash
# Signature
cosign verify ghcr.io/pelotech/xapi-lrs:0.4.0 \
  --certificate-identity-regexp 'https://github.com/pelotech/xapi-lrs/.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# Build provenance
cosign verify-attestation ghcr.io/pelotech/xapi-lrs:0.4.0 \
  --type slsaprovenance \
  --certificate-identity-regexp 'https://github.com/pelotech/xapi-lrs/.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# SBOM (releases only)
cosign verify-attestation ghcr.io/pelotech/xapi-lrs:0.4.0 \
  --type spdxjson \
  --certificate-identity-regexp 'https://github.com/pelotech/xapi-lrs/.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

SBOM files are also attached to each GitHub Release as `xapi-lrs-<version>-sbom.spdx.json` and `xapi-lrs-<version>-sbom.cdx.json`.

## License

Apache 2.0
