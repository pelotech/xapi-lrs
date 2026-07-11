# lrsql Schema Compatibility and Takeover — Design

**Date:** 2026-07-11
**Status:** Draft for review

## Goal

Make xapi-lrs genuinely lrsql-compatible at the database layer: the bundled schema
becomes lrsql's actual Postgres schema, a live lrsql database can be taken over
in place, and data we write remains readable by lrsql (round-trip compatible).
This fixes both field-reported v0.5.1 issues:

1. Authenticated xAPI calls 500 against an existing lrsql database
   (`credential_to_scope` keyed by `credential_id` in our schema vs composite
   `(api_key, secret_key)` in lrsql's).
2. `dist/migrate.js` / `pnpm db:migrate` fail on the bundled migration
   (`000001-lrsql-schema.sql` has no graphile-migrate header), so pg mode
   cannot boot a fresh database at all.

**Success criteria:**

1. Fresh Postgres database + `dist/migrate.js` (or `pnpm db:migrate`): migration
   applies, server boots, full ADL 1.0.3 conformance battery passes.
2. Fresh pglite: same result via the raw migration runner.
3. Live lrsql v0.9.x Postgres database: server boots against it unmodified,
   existing credentials authenticate, existing statements are readable, and the
   integration + conformance suites pass against a database created from
   lrsql's own DDL.
4. Data written by xapi-lrs into a takeover database satisfies lrsql's
   conventions (time-ordered statement ids, `registration`/`timestamp`/`stored`
   populated, no reliance on column defaults lrsql doesn't have), so reverting
   to lrsql remains possible.
5. Schema parity with lrsql is enforced by CI, not asserted by a comment.

## Compatibility contract

- **Pin:** lrsql v0.9.5 (latest release; its Postgres DDL is byte-identical to
  v0.9.3, the version deployed in the reporting environment). A future lrsql
  release that changes the schema becomes a new compat-target release of
  xapi-lrs, per the project's N/N-1 principle.
- **Postgres only.** lrsql's MariaDB/SQLite flavors are out of scope. Both of
  our modes share the one schema: pg (real Postgres) and pglite (Postgres in
  WASM).
- **Round-trip writes.** Takeover is one-directional operationally (lrsql stops,
  xapi-lrs starts), but everything we write must leave the database in a state
  lrsql could resume from. Simultaneous writers are out of scope.

## Schema: rewrite `000001-lrsql-schema.sql`

Replace the current file (a test fixture that drifted from upstream) with the
**flattened end-state** of lrsql v0.9.5's Postgres DDL: the base tables plus all
of lrsql's in-file migrations applied. Concretely:

- All 15 lrsql tables, including ones we don't use yet (`reaction`,
  `blocked_jwt`) — parity means a fresh xapi-lrs database is indistinguishable
  from a fresh lrsql database.
- lrsql's exact column types (`VARCHAR(255)` not `text`), nullability
  (`credential_to_scope.scope` nullable, `admin_account.passhash` nullable),
  added columns (`admin_account.oidc_issuer`, `xapi_statement.registration/
  timestamp/stored/reaction_id/trigger_id`), final enum value sets (including
  the prefixed profile scopes), constraints, and index/constraint **names** —
  names matter because the parity test diffs catalogs.
- **No column defaults.** lrsql generates ids application-side; so will we.
- Idempotent against both starting states: empty database (fresh install) and
  live lrsql database (takeover no-op). `CREATE TABLE IF NOT EXISTS`,
  guarded enum creation, `ADD COLUMN IF NOT EXISTS`.
- Committed through graphile-migrate so the file carries a valid
  `--! Previous:` / `--! Hash:` header (fixes issue 2). The header lines are SQL
  comments, so the pglite raw runner executes the same file unchanged.
- Content changes to `000001` are safe: no Postgres database has ever been
  provisioned through graphile-migrate (the parser always rejected the file),
  and existing pglite data dirs are explicitly not upgradable (see Release).

The vendored upstream reference lives at
`test/fixtures/lrsql/ddl-v0.9.5.sql` (verbatim copy of
`yetanalytics/lrsql:src/db/postgres/lrsql/postgres/sql/ddl.sql` at the pinned
tag) together with a small executor that applies it the way lrsql does
(statements in order; the guarded migrations are sequential-safe on a fresh
database — verified during implementation).

## Write path

- **Auth:** scope lookup becomes
  `SELECT scope FROM credential_to_scope WHERE api_key = $1 AND secret_key = $2`
  (composite key), tolerating NULL scopes (lrsql allows them; a NULL scope row
  grants nothing). Credential lookup itself is unchanged.
- **Statement ids:** UUIDv7 (time-ordered), matching the sort semantics of
  lrsql's SQUUIDs — lrsql's pagination orders by `id`, and ours can continue to
  as well.
- **Inserts populate lrsql's columns explicitly:** `registration` from
  `context.registration`; `timestamp` from the statement's timestamp;
  `stored` from the server clock (no more `DEFAULT now()` — there is no
  default). All ids supplied by the application everywhere (junction tables,
  documents, credentials, bootstrap).
- **Reaction columns** (`reaction_id`, `trigger_id`) are written as NULL; the
  reactions feature itself is not implemented.
- `ON CONFLICT` targets and any query that names columns are audited against
  the new shape (the takeover test suite is the enforcement).
- Statement `stored`/`timestamp` remain baked into the JSON payload as today;
  the columns are populated in addition, as lrsql does.

## Startup safety: schema probe

At boot (both drivers), probe `information_schema` for shape markers — at
minimum `credential_to_scope.api_key` and `xapi_statement.stored`. On mismatch,
exit with a clear message naming the found shape (legacy xapi-lrs 0.5.x, or
unknown) and pointing at the release notes. This converts the silent
divergence that produced issue 1 into a fail-fast with instructions. The probe
runs after migrations (pg: graphile; pglite: raw runner), so a fresh database
passes trivially.

## Migration machinery

- `dist/migrate.js` and `pnpm db:migrate` both work against an empty database
  (issue 2 fixed by the committed header).
- The duplicate `test/integration/lrsql-schema.sql` is deleted; the test
  helper applies `db/migrations/committed/000001-lrsql-schema.sql` directly.
  One source of truth — fixture drift of the kind that caused issue 1 cannot
  recur unnoticed.
- The pglite runner is unchanged (filename-tracked raw SQL application).

## Testing

1. **Parity test (new, CI):** create two schemas — one via our committed
   migration, one via the vendored lrsql DDL — and diff catalogs: tables,
   columns (type/nullability/default), constraints, indexes, enum values.
   Empty diff or fail. This is the "matching lrsql's DDL exactly" invariant.
2. **Takeover suite (new, CI):** provision a database from the vendored lrsql
   DDL, seed it with lrsql-style data (credential with composite-keyed scopes,
   pre-existing statements with lrsql-generated shapes), then run the full
   integration suite and the ADL 1.0.3 conformance battery against it.
3. **Round-trip assertions (new):** after our writes into a takeover database,
   assert lrsql invariants — ids time-ordered, `registration`/`timestamp`/
   `stored` populated, no NULLs in columns lrsql treats as required.
4. **Migration gate (new, CI):** run `node dist/migrate.js` against an empty
   Postgres from the built artifact, boot the server, and smoke one
   authenticated xAPI call. This is the issue-2 regression gate and would have
   caught it.
5. **Existing suites** (180 unit tests, integration, 1.0.3 conformance on both
   drivers) keep passing on freshly-provisioned databases.

## Release

- Breaking release: existing xapi-lrs data (pglite data dirs, hand-provisioned
  pg databases from the old fixture schema) is not upgradable; users drop and
  re-provision. The startup probe makes this explicit rather than silent.
- Add `"bump-minor-pre-major": true` to `release-please-config.json` so the
  `feat!` commit produces **0.6.0** (not 1.0.0), per semver 0.x convention.
- Release notes document: the takeover path (point at an lrsql database), the
  clean-break policy for pre-0.6 data, and the lrsql version pin.

## Out of scope

- Simultaneous lrsql + xapi-lrs writers against one database
- Converting legacy xapi-lrs (pre-0.6) data in place
- lrsql's MariaDB/SQLite backends
- Implementing lrsql features whose tables we now carry (reactions,
  `blocked_jwt` JWT blocklisting)
- The helm chart changes in pelotech/charts (unblocked by this work, shipped
  separately)
