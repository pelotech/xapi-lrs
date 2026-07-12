# lrsql Schema Compatibility and Takeover Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the bundled schema to lrsql v0.9.5's real Postgres shape (CI-enforced parity), port every query to it, and support taking over a live lrsql database with round-trip-compatible writes — fixing both field-reported v0.5.1 issues (auth 500 on lrsql databases; unbootable fresh pg databases).

**Architecture:** One schema file (`000001`, flattened lrsql end-state + our SSE trigger, valid graphile header) is the single source of truth for pg, pglite, and tests. lrsql's own upstream DDL is vendored as a fixture; a parity test diffs catalogs between a migration-built and an upstream-built database. Write paths port to composite credential keys, explicit column population, lrsql's group-member decomposition, and app-side bcrypt. A startup probe fail-fasts on wrong-shape databases.

**Tech Stack:** TypeScript/Hono, pg + @electric-sql/pglite (PG17), graphile-migrate, bcryptjs (new dep), uuidv7 (already a dep), vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-lrsql-schema-compat-design.md`

**Research artifacts (in-repo, committed with this plan):**

- `docs/superpowers/plans/assets/lrsql-flattened-v0.9.5.sql` — the flattened lrsql v0.9.5 schema, empirically verified: applies cleanly to an empty PG18 database, is idempotent (second run clean), applies cleanly on top of an upstream-DDL-built database, and `pg_dump -s` of both builds is byte-identical. This becomes the body of the new `000001` (plus our trigger block).
- `docs/superpowers/plans/assets/lrsql-upstream-ddl-v0.9.5.sql` — verbatim copy of `yetanalytics/lrsql` `src/db/postgres/lrsql/postgres/sql/ddl.sql` at tag v0.9.5. Becomes the vendored test fixture.

**Verified upstream facts the plan relies on** (from lrsql v0.9.5 source; file:line refs are into the lrsql repo):

- Final enum values, in order — `actor_usage_enum`: Actor, Object, Authority, Instructor, Team, SubActor, SubObject, SubInstructor, SubTeam, ContextAgent, ContextGroup, SubContextAgent, SubContextGroup (no `Member`). `scope_enum`: statements/write, statements/read, statements/read/mine, all/read, all, state, state/read, define, activities_profile, activities_profile/read, agents_profile, agents_profile/read (no bare `profile`). Enum order is not append-only (`statements/read/mine` sits mid-list); the parity test compares labels in order.
- Group members: lrsql writes one `statement_to_actor` row per member **with the group's positional usage** (`input/actor.clj:36-44`, `input/statement.clj:49-54,94-112`). Identified groups additionally get their own row (actor_type `Group`); **anonymous groups get no row of their own** (no IFI → skipped, `input/actor.clj:19-29`). Substatement positions use SubActor/SubObject/SubInstructor/SubTeam. Plain `agent` queries filter `usage = 'Actor'`; `related_agents=true` drops the usage filter entirely (`query.sql` postgres-actors-join).
- lrsql string columns are TEXT after its 2024-05-29 migration **except `agent_profile_document`**, which that migration skips — its `profile_id`/`agent_ifi`/`content_type` stay VARCHAR(255). Preserve the quirk; do not fix it.
- `xapi_statement.timestamp`/`stored` are **nullable** TIMESTAMPTZ (added by migration, no defaults). Only two column defaults exist in the whole schema: `is_voided DEFAULT FALSE`, `state_document.registration DEFAULT NULL`.
- `lrs_credential` gained `label TEXT` **and `is_seed BOOLEAN`** (2025-03-21 migration).
- lrsql has **no unique constraints** on statement_to_actor / statement_to_activity / statement_to_statement / attachment(statement_id, sha), and does no junction dedup (plain INSERTs, `insert.sql:43-51`); `actor`/`activity` dedup via named unique constraints `actor_idx` / `activity_activity_iri_key` + app-side merge. `state_doc_idx` is UNIQUE(state_id, activity_iri, agent_ifi, registration) with NULLs distinct — lrsql upserts documents app-side (select-then-insert/update), not via ON CONFLICT.
- lrsql SQUUIDs are UUIDv7-layout with version nibble 8 (48-bit ms timestamp prefix, colossal-squuid); UUIDv7s sort correctly against them. Our ids are already time-ordered on both columns and need no rebuild: `xapi_statement.id` (the pagination key) comes from the hand-rolled `squuid()` in `src/helpers/squuid.ts` (48-bit ms prefix, version nibble 4), and `statement_id` comes from the `uuidv7` package (`src/xapi/statement-validator.ts:35`). Both sort correctly against lrsql ids; assertions about "UUIDv7" apply to `statement_id` only.
- lrsql admin passhashes are buddy `bcrypt+sha512$...` strings — not verifiable by us (spec: admin accounts don't port).
- lrsql has zero triggers/functions/views/sequences: exactly 15 tables + 4 enums + named constraints/indexes (authoritative list = the flattened asset).

---

## File Structure

| File                                                                                                                  | Action  | Responsibility                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `db/migrations/committed/000001-lrsql-schema.sql`                                                                     | Rewrite | Flattened lrsql v0.9.5 schema + our SSE trigger block, valid graphile header            |
| `test/integration/lrsql-schema.sql`                                                                                   | Delete  | Duplicate copy; tests read the committed migration instead                              |
| `test/fixtures/lrsql/ddl-v0.9.5.sql`                                                                                  | Create  | Vendored upstream lrsql DDL (verbatim)                                                  |
| `test/fixtures/lrsql/apply-upstream-ddl.ts`                                                                           | Create  | HugSQL-aware executor that provisions a database the way lrsql would                    |
| `test/integration/schema-parity.test.ts`                                                                              | Create  | Catalog diff: migration-built vs upstream-built schema (runs on pglite, no external DB) |
| `src/helpers/passwords.ts`                                                                                            | Create  | bcryptjs hash/verify (replaces pgcrypto crypt/gen_salt)                                 |
| `src/admin/repositories/accounts.ts`                                                                                  | Modify  | App-side hashing; nullable passhash handling                                            |
| `src/middleware/authentication.ts`                                                                                    | Modify  | Composite-key scope lookup, NULL-scope filtering                                        |
| `src/admin/repositories/credentials.ts`                                                                               | Modify  | Composite-key scope CRUD, label, transactional rotateSecret                             |
| `src/auth/types.ts`, `src/middleware/authorization.ts`, `src/admin/views/credentials.ts`, `src/helpers/auth-agent.ts` | Modify  | New scope vocabulary                                                                    |
| `src/repositories/statement-decomposition.ts`                                                                         | Modify  | lrsql member/Sub\* usage mapping                                                        |
| `src/repositories/statements.ts`                                                                                      | Modify  | Explicit stored/timestamp/registration, junction gating, ON CONFLICT rewrites           |
| `src/routes/statements.ts`                                                                                            | Modify  | Attachment-insert gating on the statement `inserted` flag                               |
| `src/repositories/attachments.ts`, `activity-state.ts`, `activity-profile.ts`, `agent-profile.ts`                     | Modify  | lrsql-shape upserts                                                                     |
| `src/db-probe.ts`                                                                                                     | Create  | Startup schema probe (shared by both drivers)                                           |
| `src/server.ts`, `src/db-pglite.ts`                                                                                   | Modify  | Probe wiring; drop pglite pgcrypto extension                                            |
| `test/integration/test-db.ts`, `basic-auth.ts`, `admin-api.test.ts`                                                   | Modify  | Committed-file provisioning, new-shape fixtures, truncate list                          |
| `test/integration/takeover.test.ts`                                                                                   | Create  | Full takeover suite against upstream-built database                                     |
| `.github/workflows/ci.yml`                                                                                            | Modify  | migrate-gate job + takeover conformance job                                             |
| `release-please-config.json`                                                                                          | Modify  | `bump-minor-pre-major: true`                                                            |
| `package.json`                                                                                                        | Modify  | Add `bcryptjs` (+ `@types/bcryptjs`)                                                    |

**Sequencing reality:** the schema flip (Task 2) is atomic — integration, conformance, and bootstrap tests go red at Task 2 and return to green as the ports land, gated hard at Task 7. Unit tests, typecheck, the parity test, and the migrate gate stay green at every commit. Task-level verification lists say exactly which suites must pass at each point; the red window is deliberate.

**Local run note:** `DATABASE_DRIVER=pglite` for everything that doesn't explicitly need real Postgres; `docker compose up -d postgres` + `set -a && source .env.test && set +a` when pg is required (graphile commit procedure, migrate gate).

**Schema-freeze note:** project memory records a "no schema changes after 000001" freeze. The user lifted it on 2026-07-11 for exactly this work (see the spec).

**Formatting note:** run `pnpm run fmt` before every commit — the oxfmt/oxlint pre-commit hooks run whenever TS files are staged and will bounce unformatted new files; no verification step catches this earlier.

---

## Chunk 1: Schema foundation — vendored DDL, executor, new 000001, parity

### Task 1: Vendored upstream DDL + executor

**Files:**

- Create: `test/fixtures/lrsql/ddl-v0.9.5.sql`
- Create: `test/fixtures/lrsql/apply-upstream-ddl.ts`
- Test: `test/integration/schema-parity.test.ts` (first half — executor smoke)

- [ ] **Step 1.1: Vendor the DDL**

```bash
mkdir -p test/fixtures/lrsql
cp docs/superpowers/plans/assets/lrsql-upstream-ddl-v0.9.5.sql test/fixtures/lrsql/ddl-v0.9.5.sql
```

Then verify provenance against upstream (must be identical):

```bash
curl -sL https://raw.githubusercontent.com/yetanalytics/lrsql/v0.9.5/src/db/postgres/lrsql/postgres/sql/ddl.sql | diff - test/fixtures/lrsql/ddl-v0.9.5.sql && echo VENDOR-OK
```

Expected: `VENDOR-OK`. Add a one-line provenance comment at the top of the executor (not the SQL file — it stays verbatim).

- [ ] **Step 1.2: Write the executor**

Create `test/fixtures/lrsql/apply-upstream-ddl.ts`. It must replicate how lrsql applies its DDL, per these verified rules:

- Split the file into blocks on lines matching `/^-- :name /` (HugSQL block boundaries). Discard content before the first marker (file header comments).
- Execute each block's text in order via the **simple query protocol**: PGlite's `.query()` uses the extended protocol (single statement only) and throws `cannot insert multiple commands into a prepared statement` on multi-statement blocks (CREATE TABLE + CREATE INDEX pairs are common); its `.exec()` handles them. node-postgres `query()` handles multi-statement strings natively. Hence the `exec`-shaped runner interface below — PGlite satisfies it directly, pg via a one-line adapter.
- Substitute the HugSQL raw parameter `:sql:tz-id` (appears in the three `last_modified` timezone-conversion blocks) with `'UTC'` before executing. On a fresh database those conversions affect zero rows.
- Do not add semicolons or reflow anything else; three upstream blocks lack trailing semicolons (the two timestamp/stored ALTERs and the cascade guard SELECT) and rely on per-block execution.

```typescript
/**
 * Applies the vendored lrsql v0.9.5 Postgres DDL (test/fixtures/lrsql/ddl-v0.9.5.sql,
 * verbatim from yetanalytics/lrsql @ v0.9.5) the way lrsql itself would: one
 * HugSQL block at a time, in order. Provisions a database indistinguishable
 * from a fresh, fully-migrated lrsql install (verified by schema-parity.test.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** PGlite satisfies this natively; for pg use { exec: (t) => pool.query(t) }. */
export interface ExecRunner {
  exec(text: string): Promise<unknown>;
}

export function upstreamDdlBlocks(): string[] {
  const raw = readFileSync(join(import.meta.dirname, 'ddl-v0.9.5.sql'), 'utf8');
  const parts = raw.split(/^(?=-- :name )/m);
  // parts[0] is the file header before the first block marker
  return parts.slice(1).map((block) => block.replaceAll(':sql:tz-id', `'UTC'`));
}

export async function applyUpstreamLrsqlDdl(runner: ExecRunner): Promise<void> {
  for (const block of upstreamDdlBlocks()) {
    await runner.exec(block);
  }
}
```

- [ ] **Step 1.3: Executor smoke test (failing first)**

Create `test/integration/schema-parity.test.ts` with the smoke test only (the diff comes in Task 3):

```typescript
import { PGlite } from '@electric-sql/pglite';
import { describe, it, expect } from 'vitest';
import { applyUpstreamLrsqlDdl, upstreamDdlBlocks } from '../fixtures/lrsql/apply-upstream-ddl.ts';

describe('vendored lrsql DDL', () => {
  it('splits into the expected number of HugSQL blocks', () => {
    expect(upstreamDdlBlocks().length).toBe(49);
  });

  it('provisions a fresh database end to end', async () => {
    const db = new PGlite();
    await applyUpstreamLrsqlDdl(db);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public'`,
    );
    expect(rows[0].n).toBe(15);
    await db.close();
  });
});
```

Run: `DATABASE_DRIVER=pglite pnpm vitest run --project integration test/integration/schema-parity.test.ts`
Expected: PASS (write this test before wiring anything else to the executor; if you write it before Step 1.2's implementation you get the classic red first, but the ordering here is fixture-then-test — the red/green discipline properly starts with the behavioral tasks). If the block count differs from 49, inspect the split — do not adjust the constant without understanding why.

- [ ] **Step 1.4: Typecheck and commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean; 180 unit tests still pass.

```bash
git add test/fixtures/lrsql/ test/integration/schema-parity.test.ts
git commit -m "test: vendor lrsql v0.9.5 DDL with HugSQL-aware executor"
```

### Task 2: Rewrite 000001 with graphile header; single source of truth

**Files:**

- Rewrite: `db/migrations/committed/000001-lrsql-schema.sql`
- Delete: `test/integration/lrsql-schema.sql`
- Modify: `test/integration/test-db.ts` (applyLrsqlSchema path, TRUNCATE list)
- Modify: `src/db-pglite.ts` (drop pgcrypto extension import/registration)

- [ ] **Step 2.1: Assemble the new migration body**

Build the body in a scratch file, in this order:

1. The full content of `docs/superpowers/plans/assets/lrsql-flattened-v0.9.5.sql` (do not edit it; the parity test is its enforcement).
2. A separator comment and then our SSE trigger block, copied **verbatim** from the current `db/migrations/committed/000001-lrsql-schema.sql` (the `notify_xapi_statement_stored()` function + `trg_xapi_statement_stored` trigger, currently around lines 197–211), prefixed with a comment noting this is an xapi-lrs addition on top of lrsql's schema (SSE statement streaming) and is a documented parity exception.

Make the trigger block idempotent if it isn't already (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`).

- [ ] **Step 2.2: Commit the body through graphile-migrate to get a valid header**

graphile-migrate computes the committed-migration hash itself; do not hand-write the header. Procedure (needs real Postgres):

```bash
docker compose up -d postgres --wait
set -a && source .env.test && set +a   # sets PG* vars (no DATABASE_URL; libpq and .gmrc.cjs both fall back to PG*)
psql -c 'SELECT 1' >/dev/null   # sanity via PG* env
git rm db/migrations/committed/000001-lrsql-schema.sql
cp <scratch-body> db/migrations/current.sql
pnpm exec graphile-migrate reset --erase   # both DBs to blank slate
pnpm exec graphile-migrate commit --message "lrsql-schema"
```

Expected: `db/migrations/committed/000001-lrsql-schema.sql` (the sluggified message yields exactly this name) now starts with `--! Previous: -` and `--! Hash: sha1:<hex>` followed by a blank line and the body. graphile-migrate drops/recreates the shadow DB itself, and its default root connection is `template1` with PG\* credentials — if it ever complains about root access, `export ROOT_DATABASE_URL=postgres://xapi_lrs:xapi_lrs@localhost:5434/template1` (do NOT point it at the main database; graphile rejects `connectionString === rootConnectionString`). `db/migrations/current.sql` is reset to blank on success — do not commit a leftover `current.sql` with content; graphile writes the committed file read-only (mode 440), which is harmless.

- [ ] **Step 2.3: Prove both migration paths work**

```bash
# Drop BOTH schemas: graphile records applied migrations in the graphile_migrate
# schema, which survives dropping public — without this, db:migrate would be a
# vacuous no-op that "passes" while leaving public empty.
psql -c 'DROP SCHEMA IF EXISTS graphile_migrate CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pnpm db:migrate
psql -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"   # expect 15
```

Expected: applies without `Invalid migration` and creates the 15 tables — this is field issue 2 dying. Then the compiled path:

```bash
pnpm build && node dist/migrate.js
```

Expected: idempotent no-op run (already applied), exit 0. (pglite's raw application of the same file — header lines are SQL comments — is exercised by the Task 3 parity test and every pglite test-server boot from Chunk 2 on.)

- [ ] **Step 2.4: Single source of truth for tests**

- Delete `test/integration/lrsql-schema.sql`.
- In `test/integration/test-db.ts:49-52`, point `applyLrsqlSchema` at `../../db/migrations/committed/000001-lrsql-schema.sql`.
- Extend `TRUNCATE_SQL` (test-db.ts:54-70) with `reaction` and `blocked_jwt`.
- In `src/db-pglite.ts:16,150`, remove the pgcrypto import and `extensions: { pgcrypto }` (nothing needs it after Chunk 2; removing it now is safe because only `crypt`/`gen_salt` used it and those queries are ported in Task 4 — see the red-window note below).

- [ ] **Step 2.5: Verify the intentionally-red state and commit**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; **unit tests still 180 green** (they don't touch the DB).

Run: `DATABASE_DRIVER=pglite pnpm test:integration 2>&1 | tail -5`
Expected: RED — auth/credential/statement suites fail against the new shape (this is the documented red window; Tasks 4–7 close it). Capture the failure count in the commit message body for traceability.

```bash
git add -A db/migrations test/integration/lrsql-schema.sql test/integration/test-db.ts src/db-pglite.ts
git commit -m "feat!: rewrite bundled schema to lrsql v0.9.5 shape

BREAKING CHANGE: pre-0.6 xapi-lrs databases (pglite data dirs, fixture-built
pg databases) are not upgradable; drop and re-provision. Integration suites
are red at this commit by design; restored over the following commits."
```

### Task 3: Schema parity test

**Files:**

- Modify: `test/integration/schema-parity.test.ts` (add the diff)

- [ ] **Step 3.1: Write the parity diff (failing first if anything drifts)**

Append to `schema-parity.test.ts` a test that builds two fresh PGlite databases — one by executing the committed migration file raw (exactly like `src/db-pglite.ts` does), one via `applyUpstreamLrsqlDdl` — and compares a catalog snapshot from each. Snapshot query (run against both, compare deep-equal):

```typescript
const CATALOG_SQL = `
  SELECT 'column' AS kind,
         table_name || '.' || column_name AS name,
         ordinal_position::text AS pos,
         concat_ws('|', data_type, character_maximum_length, is_nullable, column_default) AS detail
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname, '',
         pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'index', schemaname || '.' || indexname, '', indexdef
    FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'enum', t.typname, e.enumsortorder::text, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typnamespace = 'public'::regnamespace
  ORDER BY 1, 2, 3, 4
`;
```

Filter the migration-built snapshot through the **documented parity exceptions** before comparing:

- the `_pglite_migrations` table's rows (only present when provisioned through the pglite backend; provisioning raw in this test avoids it — assert it's absent rather than filtering),
- the SSE trigger function/trigger — triggers don't appear in the catalog queries above; assert separately that `xapi_statement` has exactly one trigger named `trg_xapi_statement_stored` in the migration-built DB and zero triggers in the upstream-built DB.

Anything else that differs fails with a readable unified diff (sort both lists, `expect(migrationSnapshot).toEqual(upstreamSnapshot)`).

- [ ] **Step 3.2: Run it**

Run: `DATABASE_DRIVER=pglite pnpm vitest run --project integration test/integration/schema-parity.test.ts`
Expected: PASS. If it fails, the committed migration drifted from the flattened asset (or the asset from upstream) — fix `000001`, never the test. Note: the flattened asset was pg_dump-verified against a real upstream build; a failure here almost certainly means a transcription error in Task 2's assembly.

- [ ] **Step 3.3: Commit**

```bash
git add test/integration/schema-parity.test.ts
git commit -m "test: enforce catalog parity between bundled schema and lrsql DDL"
```

## Chunk 2: Write-path ports

### Task 4: App-side password hashing (bcryptjs)

**Files:**

- Create: `src/helpers/passwords.ts`
- Modify: `src/admin/repositories/accounts.ts`, `package.json`
- Test: `test/unit/helpers/passwords.test.ts`, modify `test/integration/admin-api.test.ts`

- [ ] **Step 4.1: Add the dependency**

Run: `pnpm add bcryptjs@^3`
(bcryptjs v3 bundles its own types; if `pnpm typecheck` later complains about missing declarations, add `@types/bcryptjs` as a devDependency instead of downgrading.)

- [ ] **Step 4.2: Failing unit test, then the helper**

`test/unit/helpers/passwords.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/helpers/passwords.ts';

describe('passwords', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('s3cret');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('s3cret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects NULL passhash (OIDC-only lrsql accounts)', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });

  it('verifies hashes produced by pgcrypto crypt(..., gen_salt(bf))', async () => {
    // GENERATE THIS LITERAL YOURSELF at implementation time — do not invent one:
    //   docker compose up -d postgres && set -a && source .env.test && set +a
    //   psql -tA -c "SELECT crypt('legacy-pass', gen_salt('bf'))"
    // (pgcrypto is still installed in the compose postgres image even though the
    // new schema no longer creates it: run CREATE EXTENSION pgcrypto in a scratch
    // database if needed.)
    const pgcryptoHash = '<paste the psql output here>';
    expect(await verifyPassword('legacy-pass', pgcryptoHash)).toBe(true);
  });
});
```

`src/helpers/passwords.ts` (note: `src/admin/repositories/accounts.ts` already exports its own `verifyPassword` — alias one of them at the import site, e.g. `import { verifyPassword as verifyHash }`):

```typescript
/**
 * Admin-account password hashing. bcrypt via bcryptjs (pure JS — no native
 * build, works in every deployment mode). Output format ($2a$/$2b$) matches
 * what pgcrypto's crypt(..., gen_salt('bf')) produced, so hashes created by
 * earlier releases still verify. lrsql's buddy-format hashes
 * (bcrypt+sha512$...) do NOT verify here by design — see the takeover notes
 * in docs/superpowers/specs/2026-07-11-lrsql-schema-compat-design.md.
 */
import bcrypt from 'bcryptjs';

const COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, passhash: string | null): Promise<boolean> {
  if (!passhash || !passhash.startsWith('$2')) return false; // NULL or non-bcrypt (e.g. lrsql buddy format)
  return bcrypt.compare(plain, passhash);
}
```

Run: `pnpm vitest run test/unit/helpers/passwords.test.ts` — FAIL before the helper exists, PASS after.

- [ ] **Step 4.3: Port `src/admin/repositories/accounts.ts`**

Three queries change (current code at lines 29–47):

- Verify (line 29-32): `SELECT id, username FROM admin_account WHERE username = $1 AND passhash = crypt($2, passhash)` → `SELECT id, username, passhash FROM admin_account WHERE username = $1`, then app-side `await verifyPassword(password, row.passhash)`; return null on mismatch or NULL passhash. Add `passhash: string | null` to the row interface.
- Create (line 34-37): `INSERT ... crypt($2, gen_salt('bf'))` → hash app-side with `hashPassword`, pass the hash as the parameter. Keep inline `gen_random_uuid()` for the id (PG13+ builtin).
- Change password (line 44-47): same treatment.

Callers (`src/admin/api.ts:53`, `src/admin/routes/auth.ts:89`, `src/admin/index.ts:199,214,240`, `src/server.ts:116-122`, `src/bootstrap.ts`) keep their signatures — the repo functions become async-hashing internally.

- [ ] **Step 4.4: Port the test fixtures that used crypt()**

`test/integration/admin-api.test.ts:24,55` insert accounts via `crypt($2, gen_salt('bf'))` — replace with app-side `await hashPassword(...)` passed as a parameter.

- [ ] **Step 4.5: Verify and commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean, unit count grows by 3.
(Integration remains red overall — the admin-api suite specifically should now get past account creation; note progress in the commit body.)

```bash
git add src/helpers/passwords.ts src/admin/repositories/accounts.ts test/unit/helpers/passwords.test.ts test/integration/admin-api.test.ts package.json pnpm-lock.yaml
git commit -m "feat: hash admin passwords app-side with bcryptjs"
```

### Task 5: Composite-key credentials, scope vocabulary

**Files:**

- Modify: `src/middleware/authentication.ts`, `src/admin/repositories/credentials.ts`, `src/auth/types.ts`, `src/middleware/authorization.ts`, `src/admin/views/credentials.ts`, `test/integration/basic-auth.ts`
- Test: modify `test/unit/middleware/authorization.test.ts`, `test/integration/bootstrap.test.ts` expectations if needed

- [ ] **Step 5.1: Auth middleware scope lookup**

`src/middleware/authentication.ts:77-81`:

```typescript
const { rows: scopeRows } = await pool.query<ScopeRow>({
  name: 'get_credential_scopes',
  text: `SELECT scope FROM credential_to_scope
         WHERE api_key = $1 AND secret_key = $2 AND scope IS NOT NULL`,
  values: [apiKey, secretKey],
});
```

(`scope IS NOT NULL` because lrsql's column is nullable and a NULL scope row grants nothing.) `credentialId` in the payload still comes from `lrs_credential.id` — unchanged.

- [ ] **Step 5.2: Admin credentials repository**

`src/admin/repositories/credentials.ts` — every `credential_to_scope` touch changes:

- Lines 18, 29, 41 (list/get joins): `LEFT JOIN credential_to_scope s ON s.credential_id = c.id` → `ON s.api_key = c.api_key AND s.secret_key = c.secret_key`. Add `c.label` to the SELECT lists and `label: string | null` to `CredentialRow`.
- Line 46-49 (create): add `label` — `INSERT INTO lrs_credential (id, api_key, secret_key, account_id, label) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`, with `label` as a defaulted-null parameter so existing callers (`ensureDefaultCredential` line 149, admin routes) compile unchanged. Leave `is_seed` untouched (NULL).
- Lines 61-69 (`setCredentialScopes` internals): delete/insert by pair —
  `DELETE FROM credential_to_scope WHERE api_key = $1 AND secret_key = $2` and
  `INSERT INTO credential_to_scope (id, api_key, secret_key, scope) VALUES (gen_random_uuid(), $1, $2, $3::scope_enum)`.
  `setCredentialScopes` currently receives only `credentialId` — resolve the pair first inside the same function (`SELECT api_key, secret_key FROM lrs_credential WHERE id = $1`) so callers (`src/admin/index.ts`, `ensureDefaultCredential` line 148-151) don't change.
- Lines 56-59 (`rotateSecret`): now an FK hazard — scope rows reference `(api_key, secret_key)` with ON DELETE CASCADE but **no ON UPDATE action**, so updating `secret_key` while scope rows exist violates `credential_fk`. Rewrite transactionally:

```typescript
// within one BEGIN/COMMIT on a dedicated client:
// 1. SELECT api_key, secret_key FROM lrs_credential WHERE id = $1 FOR UPDATE
// 2. SELECT scope FROM credential_to_scope WHERE api_key = $2 AND secret_key = $3
// 3. DELETE FROM credential_to_scope WHERE api_key = $2 AND secret_key = $3
// 4. UPDATE lrs_credential SET secret_key = $new WHERE id = $1
// 5. re-INSERT the saved scopes under (api_key, $new)
```

Follow the existing transaction pattern in the codebase (search for `BEGIN` usage; if none exists, use `pool.connect()` + try/finally release).

- [ ] **Step 5.3: Scope vocabulary**

- `src/auth/types.ts:8-17` — `XapiScope` becomes exactly lrsql's final enum:
  `'statements/write' | 'statements/read' | 'statements/read/mine' | 'all/read' | 'all' | 'state' | 'state/read' | 'define' | 'activities_profile' | 'activities_profile/read' | 'agents_profile' | 'agents_profile/read'`
- `src/middleware/authorization.ts` — replace each bare `'profile'` with the resource-appropriate prefixed scope: activity-profile routes (lines ~57,59) → `'activities_profile'` (writes) / also accept `'activities_profile/read'` on GETs, agent-profile routes (~65,67) → `'agents_profile'` / `'agents_profile/read'`, mirroring how the file already models `state` vs `state/read`. Lines ~72 and ~77 are NOT profile routes — they're the `GET /xapi/agents` and `GET /xapi/activities` metadata resources, whose accepted-scope lists currently include bare `'profile'`: replace with `'agents_profile/read'` and `'activities_profile/read'` respectively (keeping the non-profile scopes already in those lists). Update the doc comment (lines 7-17).
- `src/auth/jwt.ts:67` — `VALID_SCOPES` is a `Set<string>` containing bare `'profile'` and is cast to `XapiScope[]`, so shrinking the union produces NO type error; update the set to the new 12-value vocabulary or JWT clients silently lose the profile scopes.
- `src/admin/views/credentials.ts:9-19` — `ALL_SCOPES` = the same 12 values (a stale value here becomes a runtime `::scope_enum` cast error).
- `test/unit/middleware/authorization.test.ts:31-33` — update the `'profile'` assertions to the new scopes; add a case for the `/read` variants if the route logic gained them.

- [ ] **Step 5.4: Test fixture**

`test/integration/basic-auth.ts:22-38`: the scope insert is doubly broken (relies on `credential_id` AND the removed id default). Rewrite:

```typescript
await pool.query(
  `INSERT INTO credential_to_scope (id, api_key, secret_key, scope)
   VALUES ($1, $2, $3, $4::scope_enum)`,
  [randomUUID(), apiKey, secretKey, scope],
);
```

Also pass `label` through to the `lrs_credential` insert (the `opts.label` currently only feeds the username).

- [ ] **Step 5.5: Verify and commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean/green (unit).

Run: `DATABASE_DRIVER=pglite pnpm vitest run --project integration test/integration/bootstrap.test.ts test/integration/admin-api.test.ts 2>&1 | tail -3`
Expected: GREEN — these two suites exercise exactly what Tasks 4–5 ported (field issue 1's auth path included). Statement suites remain red until Task 6.

```bash
git add src/middleware/authentication.ts src/admin/repositories/credentials.ts src/auth/types.ts src/auth/jwt.ts src/middleware/authorization.ts src/admin/views/credentials.ts test/integration/basic-auth.ts test/unit/middleware/authorization.test.ts
git commit -m "feat: key credential scopes by (api_key, secret_key) per lrsql"
```

(`src/helpers/auth-agent.ts` needs no change — its `FULL_READ_SCOPES` values all survive; it recompiles against the new union untouched.)

### Task 6: Statement write path and lrsql decomposition

**Files:**

- Modify: `src/repositories/statement-decomposition.ts`, `src/repositories/statements.ts`, `src/repositories/attachments.ts`, `src/routes/statements.ts` (attachment-insert gating)
- Test: modify `test/unit/repositories/statement-decomposition.test.ts` (+ existing statement unit tests)

- [ ] **Step 6.1: Decomposition — failing tests first**

Update `test/unit/repositories/statement-decomposition.test.ts` to lrsql's verified semantics BEFORE touching the implementation, and watch them fail:

| Case                                 | Old expectation                 | New expectation (lrsql v0.9.5)                                                     |
| ------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------- |
| Group actor member rows              | `usage: 'Member'` (lines 42,47) | member agents get `usage: 'Actor'` (the group's position)                          |
| Identified group actor               | group row `'Actor'`             | unchanged — group row `'Actor'` (actor_type `Group`) plus member rows `'Actor'`    |
| Anonymous group actor                | (verify current behavior)       | NO row for the group itself (no IFI); member rows only                             |
| context.team members                 | `'Member'` (line 116)           | `usage: 'Team'`                                                                    |
| context.instructor group members     | (add case)                      | `usage: 'Instructor'`                                                              |
| SubStatement actor                   | `'Actor'` (~line 120-135)       | `'SubActor'`                                                                       |
| SubStatement object agent/group      | `'Object'`                      | `'SubObject'`                                                                      |
| SubStatement context instructor/team | (add cases)                     | `'SubInstructor'` / `'SubTeam'`                                                    |
| Object agent/group (top level)       | `'Object'`                      | unchanged; group members → `'Object'`                                              |
| Authority group                      | (verify)                        | authority members → `'Authority'`                                                  |
| Duplicate member in list             | (add case)                      | decomposition output deduplicated by (usage, actor_ifi, actor_type) — see Step 6.2 |

Run: `pnpm vitest run test/unit/repositories/statement-decomposition.test.ts` — FAIL.

- [ ] **Step 6.2: Port the decomposition**

`src/repositories/statement-decomposition.ts:69,101,110,113`: replace the `'Member'` literals with the parent position's usage; thread the position through the group-member walk; switch substatement positions to their `Sub*` values. Add output dedup by `(usage, actor_ifi, actor_type)` (matching the actor table's key) (lrsql doesn't dedup and tolerates duplicate junction rows; we dedup within one statement to keep re-decomposition deterministic — cross-POST duplicates are prevented by Step 6.3's gating, which is stronger than lrsql's behavior and round-trip harmless). Tests from 6.1 now PASS.

- [ ] **Step 6.3: Statement insert — explicit columns and junction gating**

`src/repositories/statements.ts`:

- INSERT (lines 53-58) becomes:

```sql
INSERT INTO xapi_statement (id, statement_id, registration, verb_iri, is_voided, payload, timestamp, stored)
VALUES ($1, $2, $3, $4, false, $5, $6, $7)
ON CONFLICT (statement_id) DO NOTHING
```

`registration` = `statement.context?.registration ?? null`; `timestamp` = the payload's `timestamp` after bake — timestamp defaulting happens in `src/xapi/statement-validator.ts:37-38`, not in `buildPayload`; align the column with whatever the baked payload carries; `stored` = the same `storedIso` already computed at lines 131-135. Id columns need no rebuild (see the header facts): row PK `id` stays the hand-rolled time-ordered `squuid()`, `statement_id` stays `uuidv7()`. Add a unit assertion that `statement_id` parses as UUID version 7 and that consecutive `squuid()` values sort ascending — do NOT assert version 7 on the row PK (its version nibble is 4).

- **Gate all dependent inserts on the statement actually inserting.** Repo-level gating for actor/activity junctions and statement_to_statement links ALREADY exists (`statements.ts:142-143` early-returns when the statement insert reported 0 rows) — verify it survives the port. The missing piece is **attachments**: `src/routes/statements.ts` (~lines 100 and 169) calls `insertAttachment` unconditionally, ignoring the `inserted` flag `insertStatement` returns. Under the old schema the unique constraint silently absorbed re-POST duplicates; under lrsql's shape (no constraint) they'd accumulate. Honor the flag in the routes — add `src/routes/statements.ts` to this task's files and commit.
- `BATCH_UPSERT_ACTORS` (lines 64-83): keep the actor upsert's `ON CONFLICT (actor_ifi, actor_type) DO NOTHING` (lrsql's `actor_idx` constraint backs it; note: lrsql merges payloads on name change, we keep DO NOTHING — accepted divergence, round-trip safe). REMOVE the junction insert's bare `ON CONFLICT DO NOTHING` (it can never fire without a constraint and reads as protection it isn't).
- Statement_to_activity (89-108): activity upsert `ON CONFLICT (activity_iri) DO UPDATE` stays (constraint exists); junction's bare `ON CONFLICT DO NOTHING` removed.
- statement_to_statement (111-116): remove `ON CONFLICT DO NOTHING`; covered by gating.
- `src/repositories/attachments.ts:12-17`: `ON CONFLICT (statement_id, attachment_sha) DO NOTHING` now ERRORS (no such constraint in lrsql) — remove the clause; covered by gating.

- [ ] **Step 6.4: Verify agent-filter semantics didn't drift from lrsql**

Read `src/repositories/statements.ts:339-351` and `src/repositories/agents.ts:72-78`. With members now written under positional usages: plain `agent` filter (`usage = 'Actor'`) matches actor-position agents AND group-actor members (lrsql parity); `related_agents` (any-usage EXISTS) matches everything including Sub\*/Team/Instructor rows (lrsql parity). No query change should be needed — this step is a read-and-confirm with a comment added where the semantics are load-bearing. If any test asserted the old member semantics, update it to the lrsql behavior.

- [ ] **Step 6.5: Verify and commit**

Run: `pnpm typecheck && pnpm test`
Expected: green (updated decomposition tests included).

Run: `DATABASE_DRIVER=pglite pnpm test:integration 2>&1 | tail -3`
Expected: statement suites now green; only document-resource suites may remain red (Task 7).

```bash
git add src/repositories/ src/routes/statements.ts test/unit/repositories/
git commit -m "feat: adopt lrsql statement decomposition and explicit column population"
```

### Task 7: Document upserts + full green gate

**Files:**

- Modify: `src/repositories/activity-state.ts`
- Verify only: `src/repositories/activity-profile.ts`, `agent-profile.ts`, `src/admin/repositories/documents.ts`, `dashboard.ts`

- [ ] **Step 7.1: State-document upsert**

`src/repositories/activity-state.ts:10-16` targets our old COALESCE expression index, which no longer exists; lrsql's `state_doc_idx` UNIQUE treats NULL registrations as distinct, so `ON CONFLICT` cannot express the no-registration case. Rewrite as lrsql does — app-side upsert in a transaction:

1. `UPDATE state_document SET contents=$_, content_type=$_, content_length=$_, last_modified=$_ WHERE state_id=$_ AND activity_iri=$_ AND agent_ifi=$_ AND registration IS NOT DISTINCT FROM $_` (preserve the existing merge-vs-replace behavior the route layer expects — read the current PUT/POST handling in `src/routes/activities.ts` document helpers before writing).
2. If `rowCount === 0`: INSERT (id via `gen_random_uuid()` inline, registration possibly NULL).
3. Both inside one transaction on a dedicated client. Concurrency note for the code comment: for NULL-registration rows lrsql has no constraint either — a lost-update race here matches lrsql's semantics; the non-NULL case is backstopped by `state_doc_idx` (retry once on unique violation).

- [ ] **Step 7.2: Confirm the two profile upserts survive as-is**

`activity-profile.ts` / `agent-profile.ts` target `(profile_id, activity_iri)` / `(profile_id, agent_ifi)` — lrsql's `activity_profile_doc_idx` / `agent_profile_doc_idx` UNIQUE constraints back exactly those targets. Run their integration suites to prove it; change nothing if green. Also confirm `dashboard.ts` interval queries still typecheck against `stored TIMESTAMPTZ` (they do — column stays timestamptz).

- [ ] **Step 7.3: FULL GREEN GATE — end of the red window**

```bash
pnpm typecheck && pnpm test
DATABASE_DRIVER=pglite pnpm test:integration
DATABASE_DRIVER=pglite pnpm test:conformance
docker compose up -d postgres --wait && set -a && source .env.test && set +a
pnpm test:integration && pnpm test:conformance
docker compose down
```

Expected: ALL green — unit, integration (both drivers), full 1.0.3 conformance battery (both drivers). The 2.0 battery stays red-by-bootstrap as documented in Phase 1's baseline. If anything is red, fix it in this task; do not proceed to Chunk 3 with a red suite.

- [ ] **Step 7.4: Commit**

```bash
git add src/repositories/activity-state.ts
git commit -m "feat: port state-document upsert to lrsql constraint semantics"
```

## Chunk 3: Takeover, safety, CI, release

### Task 8: Startup schema probe

**Files:**

- Create: `src/db-probe.ts`
- Modify: `src/server.ts`, `src/db-pglite.ts`
- Test: `test/integration/db-probe.test.ts`

- [ ] **Step 8.1: Failing tests first**

`test/integration/db-probe.test.ts` (pglite; each case provisions a scratch PGlite instance):

| Case                      | Provision with                                                                                                                                                                                                       | Expected probe result                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Current shape             | committed migration file (raw)                                                                                                                                                                                       | ok                                                                                    |
| lrsql shape, pre-takeover | `applyUpstreamLrsqlDdl` only                                                                                                                                                                                         | ok (migration adds only the trigger; the probe checks shape markers, not the trigger) |
| Legacy xapi-lrs 0.5.x     | minimal legacy DDL inline in the test: `credential_to_scope(id, credential_id uuid, scope text)` + `xapi_statement(id uuid, statement_id uuid, verb_iri text, is_voided bool, payload json, stored timestamptz)`     | error containing "pre-0.6" (assert message substrings, not exact prose)               |
| Empty database            | nothing                                                                                                                                                                                                              | error containing "no xAPI schema" and the `dist/migrate.js` hint                      |
| Unknown                   | an `xapi_statement` table WITHOUT the `registration` column plus a `credential_to_scope` with neither marker column (the statement table must exist, or the probe correctly reports the empty-database case instead) | generic mismatch error                                                                |

- [ ] **Step 8.2: Implement the probe**

`src/db-probe.ts`:

```typescript
/**
 * Startup schema probe. Verifies the connected database has the lrsql-shaped
 * schema this release requires, and fails fast with an actionable message
 * otherwise (field issue 1 was this failure surfacing as a runtime 500).
 */
import type { DbPool } from './db.ts';

export class SchemaProbeError extends Error {}

const MARKERS_SQL = `
  SELECT
    to_regclass('public.xapi_statement') IS NOT NULL                       AS has_statement_table,
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='credential_to_scope'
               AND column_name='api_key')                                  AS scopes_by_keypair,
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='credential_to_scope'
               AND column_name='credential_id')                            AS scopes_by_credential_id,
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='xapi_statement'
               AND column_name='registration')                             AS statement_has_registration
`;

export async function probeSchema(pool: DbPool): Promise<void> {
  // DbPool.query takes a QueryConfig (src/db.ts:22); a bare string breaks the
  // pglite adapter, which dereferences config.text (src/db-pglite.ts:84).
  const {
    rows: [m],
  } = await pool.query({ text: MARKERS_SQL });
  if (m.has_statement_table && m.scopes_by_keypair && m.statement_has_registration) return;
  if (!m.has_statement_table) {
    throw new SchemaProbeError(
      'Database has no xAPI schema. Run migrations first: `node dist/migrate.js` (or set AUTO_MIGRATE=true).',
    );
  }
  if (m.scopes_by_credential_id) {
    throw new SchemaProbeError(
      'Database has the pre-0.6 xapi-lrs schema, which this release cannot use. ' +
        'Pre-0.6 data is not upgradable — drop and re-provision (see the v0.6.0 release notes).',
    );
  }
  throw new SchemaProbeError(
    'Database schema does not match the lrsql v0.9.x shape this release requires (see the v0.6.0 release notes).',
  );
}
```

Wire it: `src/server.ts` pg path — after `createPool()` (line ~110) and before `bootstrapAccounts()`; pglite path — right after `createPgliteBackend()` returns (its internal migrations have run by then). On `SchemaProbeError`, log the message at fatal and `process.exit(1)`.

- [ ] **Step 8.3: Verify and commit**

Run: `pnpm typecheck && pnpm test && DATABASE_DRIVER=pglite pnpm vitest run --project integration test/integration/db-probe.test.ts`
Expected: green.

```bash
git add src/db-probe.ts src/server.ts src/db-pglite.ts test/integration/db-probe.test.ts
git commit -m "feat: fail fast on wrong-shape databases at startup"
```

### Task 9: Takeover suite

**Files:**

- Create: `test/integration/takeover.test.ts`
- Modify: `test/integration/global-setup.ts`, `test/integration/test-db.ts` (schema-source switch)
- Modify: `test/integration/test-server.ts` (optional pre-provisioned instance)
- Modify: `src/db-pglite.ts` — the seam: `createPgliteBackend` today always creates its own PGlite instance and applies migrations internally (~lines 145-156); it gains an optional pre-created instance parameter so takeover provisioning can run the upstream DDL on the instance FIRST and let the backend's migration pass perform the takeover
- Modify: `test/conformance/run-adl-suite.ts` docs comment only if needed

- [ ] **Step 9.1: lrsql-style seed fixture**

Inside `takeover.test.ts`, build the takeover scenario exactly as an operator would hit it:

1. Fresh PGlite instance → `applyUpstreamLrsqlDdl` (this is the "live lrsql database").
2. Seed lrsql-written data with plain SQL, matching lrsql's conventions (ids: any uuid is fine for seeds; realism points where cheap):
   - an `admin_account` with a buddy-format passhash string (`'bcrypt+sha512$ab12...'` literal) and one with NULL passhash + `oidc_issuer`,
   - an `lrs_credential` (id, api_key, secret_key, account_id, label) + `credential_to_scope` rows keyed by the pair — one `'all'` scope, one NULL scope,
   - statements: one plain agent statement; one **identified-group actor with two members** (group row usage Actor + member rows usage Actor); one **anonymous-group actor** (member rows only); one substatement statement (SubActor/SubObject rows); populated `registration`/`timestamp`/`stored` columns; junction rows per lrsql shape.
3. Apply the committed migration on top (the real takeover step) — assert it no-ops except adding the SSE trigger.
4. Start the app against this instance (reuse the test-server plumbing with a pre-provisioned PGlite handle — extend `createLrsTestServer` with an optional injected instance if it doesn't already accept one).

- [ ] **Step 9.2: Takeover assertions (the regression tests for field issue 1)**

- Authenticated xAPI call with the seeded lrsql credential succeeds (this exact path 500'd in v0.5.1).
- Seeded statements are retrievable: by statementId; by `agent` filter matching a group member (usage-Actor member row); with `related_agents=true` matching team/instructor members.
- Admin login with the buddy-hash account fails cleanly (401, no 500); the NULL-passhash account likewise; bootstrap of a fresh admin via env vars works alongside them.
- Round-trip writes: POST a new statement through the API, then assert directly in SQL — `registration`/`timestamp`/`stored` columns populated; the row `id` is time-ordered (sorts AFTER the seeded ids) and `statement_id` parses as UUIDv7; group members decomposed with positional usage; no NULL columns lrsql treats as required.
- Re-POST the same statement: accepted, and junction row counts unchanged (gating works).

- [ ] **Step 9.3: Conformance-on-takeover provisioning switch**

Give the integration/conformance provisioning a schema-source switch, consumed in `global-setup.ts`/`test-db.ts` (pg driver) and the pglite backend path used by tests:

- `SCHEMA_SOURCE=migration` (default): current behavior — committed migration file.
- `SCHEMA_SOURCE=lrsql`: provision via `applyUpstreamLrsqlDdl` **then** apply the committed migration on top (operator takeover flow), then continue as normal.
- Plumbing per driver: pg — both integration and conformance vitest projects run `global-setup.ts` (see `vitest.config.ts:25,40`); the switch lives there. pglite — the server under test builds its own instance via `createPgliteBackend`; when `SCHEMA_SOURCE=lrsql`, the test server pre-creates the PGlite instance, runs `applyUpstreamLrsqlDdl` on it, and hands it to the backend via the new optional-instance seam, whose normal migration pass then performs the takeover.

Run the full 1.0.3 conformance battery in takeover mode locally:

```bash
DATABASE_DRIVER=pglite SCHEMA_SOURCE=lrsql pnpm test:conformance
```

Expected: 37/37 — the conformance battery is the strongest takeover proof we have.

- [ ] **Step 9.4: Verify and commit**

Run:

```bash
pnpm typecheck && pnpm test
DATABASE_DRIVER=pglite pnpm test:integration
DATABASE_DRIVER=pglite SCHEMA_SOURCE=lrsql pnpm test:integration
DATABASE_DRIVER=pglite SCHEMA_SOURCE=lrsql pnpm test:conformance
```

Expected: all green — the takeover-mode integration run backs spec Testing item 2 / exit criterion 3 directly.

```bash
git add test/integration/takeover.test.ts test/integration/global-setup.ts test/integration/test-db.ts test/integration/test-server.ts src/db-pglite.ts
git commit -m "test: prove lrsql takeover end to end"
```

### Task 10: CI, release config, docs

**Files:**

- Modify: `.github/workflows/ci.yml`, `release-please-config.json`, `README.md`

- [ ] **Step 10.1: CI migrate gate (field issue 2's regression gate)**

New job in ci.yml alongside `integration-tests` (reuse its compose/pnpm steps):

```yaml
migrate-gate:
  name: Migrate Gate (fresh pg)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
    - name: Start Postgres
      # postgres ONLY — a bare `up -d --wait` would also start the xapi-lrs
      # container, stealing ports 8081/8091 from the compiled-artifact
      # server this gate exists to test.
      run: docker compose up -d --wait postgres
    - name: Load test env
      run: grep -v '^\s*#' .env.test | grep -v '^\s*$' >> "$GITHUB_ENV"
    - uses: pnpm/action-setup@8912a9102ac27614460f54aedde9e1e7f9aec20d # v6
    - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm build
    - name: Run migrations against empty database (compiled artifact)
      run: node dist/migrate.js
    - name: Boot server and smoke an authenticated request
      # /xapi/about is unauthenticated (src/app.ts skips auth for it); the
      # spec requires an AUTHENTICATED smoke, so bootstrap a known credential
      # and hit /xapi/statements with it.
      run: |
        LRS_ADMIN_USER=admin LRS_ADMIN_PASSWORD=admin-ci-password \
        LRS_API_KEY_DEFAULT=ci-key LRS_API_SECRET_DEFAULT=ci-secret \
        node dist/server.js &
        SERVER_PID=$!
        ok=""
        for i in $(seq 1 30); do
          curl -sf http://localhost:8091/healthz && ok=1 && break || sleep 1
        done
        [ -n "$ok" ] || { echo "server never became healthy"; exit 1; }
        curl -sf -u ci-key:ci-secret -H 'X-Experience-API-Version: 1.0.3' \
          'http://localhost:8081/xapi/statements?limit=1'
        kill $SERVER_PID
    - name: Cleanup
      if: always()
      run: docker compose down
```

(Endpoints/ports verified: `/healthz` exists on the admin port 8091, `src/server.ts:186`; LRS port 8081 per `.env.test`.) Add `migrate-gate` to the `build` job's `needs`.

**Required in this step (not optional):** remove the docker-compose postgres `docker-entrypoint-initdb.d` schema mount (`docker-compose.yml:11`). Two things depend on removal: this gate (the migration must be what creates the schema) and Step 10.2's pg takeover cells (with the mount, the container is pre-initialized with the committed migration BEFORE global-setup applies the upstream DDL — inverting the takeover order and testing nothing). Integration/conformance jobs survive removal because `global-setup.ts` applies the schema itself. The compose `xapi-lrs` quick-start service then boots against an empty database and the new probe exits 1 — uncomment `AUTO_MIGRATE: "true"` (`docker-compose.yml:40`) and document it in the README's compose section (Step 10.3).

- [ ] **Step 10.2: Takeover conformance job**

Extend the `conformance-tests` matrix with a takeover cell rather than a whole new job — add `schema-source: [migration, lrsql]` ONLY for the `xapi-version: '1.0.3'` combinations (use matrix `include`/`exclude` so 2.0 doesn't double), passing `SCHEMA_SOURCE` through to the test env. Job name should show it (include `${{ matrix.schema-source }}`): `Conformance Tests (pglite, xAPI 1.0.3, lrsql)`. Also add ONE takeover cell to the `integration-tests` matrix (`pglite × SCHEMA_SOURCE=lrsql`) so exit criterion 3's integration half is CI-enforced, not local-only.

- [ ] **Step 10.3: Release config + README**

- `release-please-config.json`: `"packages": { ".": { "bump-minor-pre-major": true } }`.
- README: update the features list ("lrsql-compatible schema (v0.9.5)"), add a "Taking over an lrsql database" section (point at the same DB, run migrations, bootstrap admin via env — admin accounts don't port, credentials do), and a breaking-change note for pre-0.6 data. Update the compose quick-start for the initdb-mount removal Step 10.1 performed (AUTO_MIGRATE now on).

- [ ] **Step 10.4: Full verification sweep + commit**

```bash
pnpm typecheck && pnpm test
DATABASE_DRIVER=pglite pnpm test:integration
DATABASE_DRIVER=pglite pnpm test:conformance
DATABASE_DRIVER=pglite SCHEMA_SOURCE=lrsql pnpm test:conformance
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"
```

Expected: all green + `yaml ok`.

```bash
git add .github/workflows/ci.yml release-please-config.json README.md docker-compose.yml
git commit -m "ci: gate migrations and lrsql takeover; bump minor pre-major"
```

---

## PR framing (execution handoff notes)

- PR title must be `feat!: adopt lrsql v0.9.5 schema and support lrsql takeover` (squash-merge title drives release-please; with `bump-minor-pre-major` this produces **0.6.0**).
- PR body: both field issues fixed, breaking-change section (pre-0.6 data clean break, scope vocabulary change, admin accounts don't port from lrsql), takeover how-to, parity guarantee.
- The branch will contain the unpushed local-main commits (Phase 1 squash + spec/plan docs); before opening the PR, reset local main to origin/main once PR #71 has merged and rebase this branch onto it, re-applying the spec/plan doc commits.

## Exit criteria (from the spec)

- [ ] Fresh pg via `dist/migrate.js` boots and passes the full 1.0.3 battery (migrate-gate + conformance jobs)
- [ ] Fresh pglite boots and passes (existing jobs)
- [ ] Takeover: upstream-DDL database + committed migration passes integration + full 1.0.3 battery (`SCHEMA_SOURCE=lrsql`)
- [ ] Round-trip write assertions green (takeover.test.ts)
- [ ] Parity test green and enforcing (catalog diff with documented exceptions only)
- [ ] Startup probe fail-fasts on legacy/empty/unknown shapes with actionable messages
- [ ] `bump-minor-pre-major` set; PR titled `feat!:`; release notes cover takeover + clean break
