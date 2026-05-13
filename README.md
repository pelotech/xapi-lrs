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

## Configuration

All configuration is via environment variables. See `.env.test` for defaults.

| Variable                            | Default     | Description                                           |
| ----------------------------------- | ----------- | ----------------------------------------------------- |
| `LRS_PORT` / `PORT`                 | `8081`      | xAPI HTTP port                                        |
| `LRS_ADMIN_PORT` / `ADMIN_PORT`     | `8091`      | Admin/health/metrics port                             |
| `DATABASE_DRIVER`                   | `pg`        | Database driver: `pg` (PostgreSQL) or `pglite`        |
| `PGLITE_DATA_DIR`                   | (none)      | PGlite data directory; omit for in-memory             |
| `PGHOST`                            | `localhost` | PostgreSQL host                                       |
| `PGPORT`                            | `5432`      | PostgreSQL port                                       |
| `PGDATABASE`                        | `xapi_lrs`  | PostgreSQL database                                   |
| `PGUSER`                            | `xapi_lrs`  | PostgreSQL user                                       |
| `PGPASSWORD`                        | (empty)     | PostgreSQL password                                   |
| `DATABASE_URL`                      | (none)      | Full connection string (overrides PG\* vars)          |
| `JWT_ISSUER`                        | (none)      | JWT issuer for token validation                       |
| `JWT_AUDIENCE`                      | (none)      | JWT audience for token validation                     |
| `JWKS_URI`                          | (none)      | JWKS endpoint URI                                     |
| `OIDC_DISCOVERY_URL`                | (none)      | OIDC discovery URL (auto-discovers JWKS)              |
| `LRS_ADMIN_USER`                    | (none)      | Bootstrap admin username                              |
| `LRS_ADMIN_PASSWORD`                | (none)      | Bootstrap admin password                              |
| `ADMIN_SESSION_SECRET`              | (random)    | Session secret (required in production)               |
| `LOG_LEVEL`                         | `info`      | Log level (silent/fatal/error/warn/info/debug/trace)  |
| `CORS_ORIGIN`                       | `*`         | CORS allowed origin                                   |
| `LRSQL_STMT_GET_DEFAULT`            | `50`        | Default `GET /statements` page size when no `limit`   |
| `LRSQL_STMT_GET_MAX`                | `50`        | Hard cap on `GET /statements` `limit` (silent clamp)  |
| `PG_STATEMENT_TIMEOUT_MS`           | `30000`     | Per-statement DB query timeout (`0` disables)         |
| `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS` | `60000`     | Idle-in-transaction connection timeout (`0` disables) |

## Scripts

| Script                  | Description                                 |
| ----------------------- | ------------------------------------------- |
| `pnpm dev`              | Start with hot reload (tsx watch)           |
| `pnpm build`            | Compile TypeScript to `dist/`               |
| `pnpm start`            | Run compiled output                         |
| `pnpm test`             | Run unit tests                              |
| `pnpm test:integration` | Run integration tests (requires PostgreSQL) |
| `pnpm test:conformance` | Run ADL conformance suite                   |
| `pnpm typecheck`        | Type-check without emitting                 |
| `pnpm lint`             | Lint with oxlint                            |
| `pnpm fmt`              | Format with oxfmt                           |
| `pnpm db:migrate`       | Run database migrations                     |
| `pnpm docker:build`     | Build Docker image                          |
| `pnpm docker:up`        | Build and start full stack (postgres + lrs) |
| `pnpm docker:down`      | Stop the stack                              |

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

## License

Apache 2.0
