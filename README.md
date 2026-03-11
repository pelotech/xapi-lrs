# xapi-lrs

A production-ready, xAPI 1.0.3 conformant Learning Record Store built on [Hono](https://hono.dev) + PostgreSQL.

## Features

- Full xAPI 1.0.3 compliance (statements, documents, agents, activities)
- Statement validation per xAPI Data spec sections 2.2-2.6 and 4.0
- Multipart/mixed attachment support
- Server-Sent Events (SSE) for real-time statement streaming
- JWT and Basic Auth (credential-based) authentication
- Admin UI with dashboard, credential management, and statement browser
- OpenTelemetry metrics (Prometheus exporter)
- PostgreSQL with pg_notify for event-driven architecture

## Quick Start

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

The LRS will be available at `http://localhost:8081` and the admin server at `http://localhost:8091`.

## Configuration

All configuration is via environment variables. See `.env.test` for defaults.

| Variable | Default | Description |
|---|---|---|
| `LRS_PORT` / `PORT` | `8081` | xAPI HTTP port |
| `LRS_ADMIN_PORT` / `ADMIN_PORT` | `8091` | Admin/health/metrics port |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGDATABASE` | `xapi_lrs` | PostgreSQL database |
| `PGUSER` | `xapi_lrs` | PostgreSQL user |
| `PGPASSWORD` | (empty) | PostgreSQL password |
| `DATABASE_URL` | (none) | Full connection string (overrides PG* vars) |
| `JWT_ISSUER` | (none) | JWT issuer for token validation |
| `JWT_AUDIENCE` | (none) | JWT audience for token validation |
| `JWKS_URI` | (none) | JWKS endpoint URI |
| `OIDC_DISCOVERY_URL` | (none) | OIDC discovery URL (auto-discovers JWKS) |
| `LRS_ADMIN_USER` | (none) | Bootstrap admin username |
| `LRS_ADMIN_PASSWORD` | (none) | Bootstrap admin password |
| `ADMIN_SESSION_SECRET` | (random) | Session secret (required in production) |
| `LOG_LEVEL` | `info` | Log level (silent/fatal/error/warn/info/debug/trace) |
| `CORS_ORIGIN` | `*` | CORS allowed origin |

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start with hot reload (tsx watch) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled output |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run integration tests (requires PostgreSQL) |
| `pnpm test:conformance` | Run ADL conformance suite |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | Lint with oxlint |
| `pnpm fmt` | Format with oxfmt |
| `pnpm db:migrate` | Run database migrations |
| `pnpm docker:build` | Build Docker image |
| `pnpm docker:up` | Build and start full stack (postgres + lrs) |
| `pnpm docker:down` | Stop the stack |

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
