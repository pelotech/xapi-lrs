# xAPI 1.0.3 LRS — Implementation Status

## Overview

A spec-compliant xAPI 1.0.3 Learning Record Store verified against the ADL conformance test suite: **1365/1365 tests passing (100%)**.

### Reference Material

- [xAPI 1.0.3 Data Model](https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md)
- [xAPI 1.0.3 Communication](https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Communication.md)
---

## Architecture

```
HTTP request
  → Express middleware stack
      xapi-version.middleware.ts      – X-Experience-API-Version 1.0.x validation
      xapi-alternate-syntax.middleware.ts – POST ?method=GET|PUT|DELETE rewriting
      xapi-query-params.middleware.ts – reject unknown query parameters
      authentication.ts              – Basic Auth (xapi.tokens) + OIDC JWT
      xapi-scopes.ts                 – scope-based authorization
  → TSOA controller (parameter extraction, response shaping)
  → pg-xapi.* query modules (PostgreSQL via pg.Pool)
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Types | Fresh from spec (`types.ts`) | Spec-precise; no external type dependencies |
| Storage layer | Direct `pg.Pool` queries in `pg-xapi.*` modules | No ORM; explicit SQL; full control over JSONB operators and keyset pagination |
| Agent query param | `string` parsed via `JSON.parse` | xAPI spec encodes Agent as JSON in query string; TSOA can't auto-parse this |
| Document body handling | `express.raw()` scoped to document paths | Document resources accept arbitrary content types, not just JSON |
| Concurrency control | Validated in controller, enforced in query layer | Activity Profile and Agent Profile REQUIRE If-Match/If-None-Match per spec |
| Attachment storage | `AssetStore` interface (local filesystem) | Content-addressed by SHA-256; metadata in `xapi.attachments` table |
| Multi-tenancy | Row-Level Security on all `xapi.*` tables | `tenant_id` resolved via `private.as_user_xapi_basic_auth()` or `private.as_user_oidc()` |

---

## What's Complete

### REST Surface (all 7 resources)

| Resource | Path | Methods | Controller |
|----------|------|---------|------------|
| About | `/xapi/about` | GET, HEAD | `about.controller.ts` |
| Statements | `/xapi/statements` | GET, HEAD, PUT, POST | `statements.controller.ts` |
| State | `/xapi/activities/state` | GET, HEAD, PUT, POST, DELETE | `state.controller.ts` |
| Activity Profile | `/xapi/activities/profile` | GET, HEAD, PUT, POST, DELETE | `activity-profile.controller.ts` |
| Agent Profile | `/xapi/agents/profile` | GET, HEAD, PUT, POST, DELETE | `agent-profile.controller.ts` |
| Activities | `/xapi/activities` | GET, HEAD | `activities.controller.ts` |
| Agents | `/xapi/agents` | GET, HEAD | `agents.controller.ts` |

HEAD is auto-derived by Express from GET handlers. The middleware stack (version, query params, auth, scopes) normalizes HEAD→GET so all validation applies identically.

### Statement Validation

Zod schemas in `statement.schema.ts` enforce all xAPI 1.0.3 rules:

- Agent: exactly one IFI; `mbox` must be `mailto:` IRI
- Group: anonymous requires `member`; identified requires exactly one IFI; no nesting
- Statement: requires `actor`, `verb`, `object`; `id` must be valid UUID; `timestamp` must be ISO 8601
- SubStatement: no `id`, `stored`, `version`, `authority`; no nested SubStatements
- Voiding: verb must be `http://adlnet.gov/expapi/verbs/voided`; object must be StatementRef

### PostgreSQL Storage

All data stored in the `xapi` schema. Migrations in `migrations/`:

| Migration | Purpose |
|-----------|---------|
| `00004_add_xapi_schema.sql` | All xAPI tables, indexes, RLS policies, auth function |
| `00005_add_token_scopes.sql` | Add `scopes` column to `xapi.tokens` |

**Tables:** `statements`, `documents`, `activities`, `agents`, `tokens`, `attachments`

**Query modules** (split for maintainability, all under 20KB):

| Module | Responsibility |
|--------|---------------|
| `pg-xapi.shared.ts` | Shared types (`Queryable`, `PersonData`), agent/activity upsert helpers, `extractAllActivities` |
| `pg-xapi.statements.ts` | Statement CRUD, `queryStatements` with keyset pagination, related-filter SQL, `statementsMatch`, cursor encode/decode |
| `pg-xapi.documents.ts` | State, activity profile, agent profile document CRUD with merge and concurrency control |
| `pg-xapi.resources.ts` | Attachment metadata, activity/agent lookups |
| `pg-xapi.queries.ts` | Barrel re-export — preserves `import * as Q from './pg-xapi.queries.js'` for all consumers |

### Authentication & Authorization

**Basic Auth:** Token ID + secret looked up via `private.as_user_xapi_basic_auth()`, which resolves `tenant_id` and `user_sub` into GUCs for RLS.

**OIDC JWT:** Verified via `jose` JWKS. Maps JWT claims to tenant context via `private.as_user_oidc()`.

**Scope enforcement** (`xapi-scopes.ts`):

| Scope | Gates |
|-------|-------|
| `statements/write` | POST/PUT statements |
| `statements/read` | GET statements |
| `statements/read/mine` | GET statements (filtered to own) |
| `state` | GET/PUT/POST/DELETE state documents |
| `define` | Activities/Agents lookup; activity definitions in statements |
| `profile` | GET/PUT/POST/DELETE activity profile and agent profile |
| `all/read` | Unrestricted read across all resources |
| `all` | Unrestricted access (default for new tokens) |

GET `/xapi/about` bypasses scope checks (per spec).

### Attachments (multipart/mixed)

Fully implemented in `multipart.ts` and `statements.controller.ts`:

- Custom multipart parser (not multer) — parses `multipart/mixed` boundaries
- First part = statement JSON; subsequent parts = binary attachments matched by SHA-256 hash
- Validates: excess attachments rejected; all declared sha2s (including fileUrl) checked
- Binary data stored via `AssetStore` (content-addressed by SHA-256)
- `fileUrl` attachments: raw data stored if sent inline; returned on GET `attachments=true`
- GET with `attachments=true` reconstructs `multipart/mixed` response

### Statement Query & Pagination

- Keyset pagination via `(stored, id)` cursor — no offset-based pagination
- `StatementResult.more` contains `/xapi/statements?cursor=<base64url>`
- Filters: `verb`, `activity`, `agent`, `registration`, `since`, `until`, `ascending`
- `related_activities=true`: JSONB `@>` containment across all 4 `contextActivities` arrays + SubStatement
- `related_agents=true`: JSONB containment across `authority`, `instructor`, `team` + SubStatement
- Voided statements excluded from normal queries; retrievable via `voidedStatementId`

### Statement Format Transformations (`statement-format.ts`)

- `format=exact` — return statements as stored (default)
- `format=ids` — strip definitions, display names, agent names; Activities → `{ id }` only (no `objectType`)
- `format=canonical` — apply `Accept-Language` to LanguageMap fields; merge LRS-known Activity definitions

### Alternate Request Syntax (`xapi-alternate-syntax.middleware.ts`)

For clients that can't send custom headers or methods beyond GET/POST:

- `POST /xapi/statements?method=GET` → rewrites to GET
- `POST /xapi/statements?method=PUT` → rewrites to PUT
- `POST /xapi/activities/state?method=DELETE` → rewrites to DELETE
- Headers (`Authorization`, `X-Experience-API-Version`, etc.) promoted from form body
- Body content from `content` form parameter

### Protocol-Level Coverage

- `X-Experience-API-Version` header validation (accepts `1.0.x`, rejects others)
- `X-Experience-API-Consistent-Through` header on all statement responses
- Unknown query parameter rejection (400) on all xAPI endpoints
- HEAD method support on all GET endpoints with correct middleware normalization
- ETag / If-Match / If-None-Match concurrency for profile documents
- Profile PUT ETag behavior: 409 for existing resource, 400 for new resource without ETag

### Token Management (complete)

Admin UI with full CRUD for `xapi.tokens`:
- htmx-powered dashboard at `/admin/xapi/tokens`
- Create tokens with scoped permissions, bcrypt-hashed secrets
- List, search, and delete tokens
- Session cookie authentication with secure flag

### Statement Forwarding (complete)

Per-tenant forward targets with background worker:
- `xapi.forward_targets` table with per-tenant configuration
- `ForwardWorker` with batched delivery, exponential backoff retry
- Strips `stored`/`authority` before forwarding per spec
- Catch-up queries from watermark for missed statements

### SSE Streaming (complete)

Real-time statement streaming via Server-Sent Events:
- `GET /xapi/statements/stream` endpoint
- PostgreSQL LISTEN/NOTIFY for push-based delivery
- Tenant-scoped streaming with scope enforcement

### Rate Limiting (complete)

Three-layer rate limiting:
- IP-based rate limiting (global)
- Per-tenant rate limiting (xAPI endpoints)
- Admin endpoint rate limiting

### JWS Signature Verification (complete)

Full cryptographic verification of signed statements per xAPI §2.6:
- Validates JWS compact serialization structure
- Extracts x5c certificate chain from JWS header
- Imports X.509 certificate and verifies RS256/RS384/RS512 signatures via `jose`
- Rejects forged signatures, tampered payloads, missing certificates

### Test Coverage

32 test files, 537 tests (all passing):

| Category | Files | Focus |
|----------|-------|-------|
| Unit | `statement-format.spec.ts`, `statement.schema.spec.ts`, `agent-ifi.spec.ts`, `xapi-version.middleware.spec.ts`, `xapi-alternate-syntax.middleware.spec.ts`, `xapi-query-params.middleware.spec.ts`, `xapi-scopes.spec.ts`, `jws-signature.spec.ts` | Validation, formatting, middleware, JWS verification |
| Query | `pg-xapi.statements.spec.ts`, `pg-xapi.query.spec.ts`, `pg-xapi.documents.spec.ts`, `pg-xapi.resources.spec.ts` | SQL generation, cursor encoding, document CRUD |
| Integration | `xapi-protocol.integration.spec.ts`, `xapi-statements.integration.spec.ts`, `xapi-statements-query.integration.spec.ts`, `xapi-documents.integration.spec.ts`, `xapi-scopes-basic.integration.spec.ts`, `xapi-scopes-advanced.integration.spec.ts`, `xapi-statements-stream.integration.spec.ts` | Full HTTP stack with mock pool |
| Admin / E2E | `admin-routes.spec.ts`, `tokens-list.spec.ts`, `forward-targets-list.spec.ts`, `forward-worker.spec.ts`, `rate-limit-middleware.spec.ts`, `e2e-tokens.spec.ts` | Admin UI, forwarding, rate limiting, token E2E |

---

## Remaining Work

### JWT Authority on Statements

Statements should carry an `authority` field identifying the credential that submitted them. Currently not populated.

- On POST/PUT: set `authority` to the Agent representing the authenticated credential
- Basic Auth tokens → authority from token metadata
- OIDC JWT → authority from JWT claims (iss/sub)

### S3 / Shared AssetStore

The current `AssetStore` writes to the local filesystem (`os.tmpdir()`). For production:

- Implement S3-backed `AssetStore`
- Select backend via config (`ASSET_STORE_TYPE=local|s3`)
- Same content-addressed interface (SHA-256 key)

---

## Verification

```bash
# Type safety
pnpm typecheck            # tsc --noEmit, 0 errors

# Lint
pnpm lint                 # oxlint, 0 errors

# Tests
pnpm test                 # vitest, 537 tests pass

# TSOA generation
pnpm tsoa:generate        # routes.ts + swagger.json
```
