/**
 * End-to-end takeover suite — the regression proof for the two field-reported
 * v0.5.1 issues, driven exactly as an operator hits them:
 *
 *   1. Provision a FRESH database with lrsql's OWN upstream DDL (the "live
 *      lrsql database" an operator already runs) and seed it with data in
 *      lrsql's on-disk shapes (buddy-format passhashes, composite-keyed
 *      credential scopes, group-member decomposition under positional usages,
 *      Sub* substatement usages, explicit registration/timestamp/stored).
 *   2. Apply OUR committed migration on top (the takeover) and assert it is a
 *      schema no-op except for adding our SSE trigger.
 *   3. Boot the app against that taken-over database and prove:
 *        - authenticated xAPI reads/writes work with the seeded lrsql
 *          credential (field issue 1: this exact path 500'd in v0.5.1),
 *        - lrsql-written statements are retrievable, including by an agent
 *          filter that matches a decomposed group member and related_agents
 *          matching context team/instructor members,
 *        - lrsql admin passhashes (buddy-format and NULL) fail auth cleanly
 *          (401, never 500) while a freshly-bootstrapped admin still works,
 *        - our writes round-trip in lrsql's shape (explicit columns, UUIDv7
 *          statement ids, time-ordered row ids, positional member usage) and
 *          re-POSTs don't duplicate junction rows.
 *
 * PGlite-backed regardless of DATABASE_DRIVER: the suite builds its own
 * upstream-provisioned instance and injects it into the test server via the
 * createPgliteBackend takeover seam.
 */

import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAccount } from '../../src/admin/repositories/accounts.ts';
import { squuid } from '../../src/helpers/squuid.ts';
import { createMetrics } from '../../src/metrics.ts';
import { applyUpstreamLrsqlDdl } from '../fixtures/lrsql/apply-upstream-ddl.ts';
import { createLrsTestServer } from './test-server.ts';
import type { LrsTestServerHandle } from './test-server.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

// ---------------------------------------------------------------------------
// Seed data — hand-authored to lrsql's ACTUAL row shapes (see the vendored DDL
// and the Task 6 decomposition rules), NOT computed by our own decomposition,
// so the takeover-read guarantee is independent of the write path under test.
// ---------------------------------------------------------------------------

const ifi = (mbox: string): string => `mbox::${mbox}`;

// Seeded credential (composite-keyed scopes, one 'all' + one NULL — lrsql's
// nullable scope column).
const API_KEY = 'seeded-lrsql-api-key';
const SECRET_KEY = 'seeded-lrsql-secret-key';
const SEEDED_AUTH = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');

// Admin accounts that must NOT port: a buddy-format passhash and a
// NULL-passhash OIDC account.
const BUDDY_USERNAME = 'lrsql-buddy-admin';
const BUDDY_PASSHASH = 'bcrypt+sha512$a1b2c3d4e5f60718$12$e9Xq0oJ0m1n2o3p4q5r6s7t8u9v0w1x2';
const OIDC_USERNAME = 'lrsql-oidc-admin';

// Statement ids (the xAPI ids; any UUID is fine for seeds).
const SA = randomUUID(); // plain agent + context instructor/team groups
const SB = randomUUID(); // identified group actor with two members
const SC = randomUUID(); // anonymous group actor (members only)
const SD = randomUUID(); // substatement (SubActor/SubObject)
const SEEDED_STATEMENT_IDS = [SA, SB, SC, SD];

const REG_A = randomUUID();

// Activity IRIs
const ACT_1 = 'http://example.com/activities/act-1';
const ACT_2 = 'http://example.com/activities/act-2';
const ACT_3 = 'http://example.com/activities/act-3';

// Distinct actor entity rows referenced by the junction rows below. lrsql's
// actor_fk requires each (actor_ifi, actor_type) to exist in `actor`.
const SEED_ACTORS: Array<{ ifi: string; type: 'Agent' | 'Group'; name?: string }> = [
  { ifi: ifi('mailto:alice@example.com'), type: 'Agent', name: 'Alice' },
  { ifi: ifi('mailto:instructors@example.com'), type: 'Group', name: 'Instructors' },
  { ifi: ifi('mailto:instructor1@example.com'), type: 'Agent', name: 'Instructor One' },
  { ifi: ifi('mailto:teamers@example.com'), type: 'Group', name: 'Team Alpha' },
  { ifi: ifi('mailto:teammate1@example.com'), type: 'Agent', name: 'Teammate One' },
  { ifi: ifi('mailto:team-b@example.com'), type: 'Group', name: 'Team B' },
  { ifi: ifi('mailto:member1@example.com'), type: 'Agent', name: 'Member One' },
  { ifi: ifi('mailto:member2@example.com'), type: 'Agent', name: 'Member Two' },
  { ifi: ifi('mailto:anon1@example.com'), type: 'Agent', name: 'Anon One' },
  { ifi: ifi('mailto:anon2@example.com'), type: 'Agent', name: 'Anon Two' },
  { ifi: ifi('mailto:main@example.com'), type: 'Agent', name: 'Main Actor' },
  { ifi: ifi('mailto:subactor@example.com'), type: 'Agent', name: 'Sub Actor' },
  { ifi: ifi('mailto:subobject@example.com'), type: 'Agent', name: 'Sub Object' },
];

interface SeedStatement {
  statementId: string;
  registration: string | null;
  verbIri: string;
  payload: Record<string, unknown>;
  timestamp: string;
  stored: string;
  // Explicit statement_to_actor rows in lrsql's decomposition shape.
  actorRows: Array<{ ifi: string; type: 'Agent' | 'Group'; usage: string }>;
  // Explicit statement_to_activity rows.
  activityRows: Array<{ iri: string; usage: string }>;
}

function buildSeedStatements(): SeedStatement[] {
  const authority = { objectType: 'Agent', account: { homePage: 'http://lrsql', name: 'lrsql' } };
  const ts = (n: number): string => new Date(Date.UTC(2021, 0, 1, 0, 0, n)).toISOString();

  const alice = { objectType: 'Agent', mbox: 'mailto:alice@example.com', name: 'Alice' };

  // A: plain agent, with context.instructor and context.team as identified
  // groups (each one member). lrsql writes the group's OWN row plus a row per
  // member, all under the group's positional usage (Instructor / Team).
  const stmtA: SeedStatement = {
    statementId: SA,
    registration: REG_A,
    verbIri: 'http://example.com/verbs/experienced',
    timestamp: ts(1),
    stored: ts(1),
    payload: {
      id: SA,
      actor: alice,
      verb: { id: 'http://example.com/verbs/experienced', display: { 'en-US': 'experienced' } },
      object: { objectType: 'Activity', id: ACT_1 },
      context: {
        registration: REG_A,
        instructor: {
          objectType: 'Group',
          mbox: 'mailto:instructors@example.com',
          name: 'Instructors',
          member: [{ objectType: 'Agent', mbox: 'mailto:instructor1@example.com', name: 'Instructor One' }],
        },
        team: {
          objectType: 'Group',
          mbox: 'mailto:teamers@example.com',
          name: 'Team Alpha',
          member: [{ objectType: 'Agent', mbox: 'mailto:teammate1@example.com', name: 'Teammate One' }],
        },
      },
      authority,
      stored: ts(1),
      timestamp: ts(1),
      version: '1.0.0',
    },
    actorRows: [
      { ifi: ifi('mailto:alice@example.com'), type: 'Agent', usage: 'Actor' },
      { ifi: ifi('mailto:instructors@example.com'), type: 'Group', usage: 'Instructor' },
      { ifi: ifi('mailto:instructor1@example.com'), type: 'Agent', usage: 'Instructor' },
      { ifi: ifi('mailto:teamers@example.com'), type: 'Group', usage: 'Team' },
      { ifi: ifi('mailto:teammate1@example.com'), type: 'Agent', usage: 'Team' },
    ],
    activityRows: [{ iri: ACT_1, usage: 'Object' }],
  };

  // B: identified group actor with two members. lrsql writes the group row
  // (actor_type Group) under usage Actor PLUS a row per member under the same
  // Actor usage.
  const stmtB: SeedStatement = {
    statementId: SB,
    registration: null,
    verbIri: 'http://example.com/verbs/attempted',
    timestamp: ts(2),
    stored: ts(2),
    payload: {
      id: SB,
      actor: {
        objectType: 'Group',
        mbox: 'mailto:team-b@example.com',
        name: 'Team B',
        member: [
          { objectType: 'Agent', mbox: 'mailto:member1@example.com', name: 'Member One' },
          { objectType: 'Agent', mbox: 'mailto:member2@example.com', name: 'Member Two' },
        ],
      },
      verb: { id: 'http://example.com/verbs/attempted', display: { 'en-US': 'attempted' } },
      object: { objectType: 'Activity', id: ACT_2 },
      authority,
      stored: ts(2),
      timestamp: ts(2),
      version: '1.0.0',
    },
    actorRows: [
      { ifi: ifi('mailto:team-b@example.com'), type: 'Group', usage: 'Actor' },
      { ifi: ifi('mailto:member1@example.com'), type: 'Agent', usage: 'Actor' },
      { ifi: ifi('mailto:member2@example.com'), type: 'Agent', usage: 'Actor' },
    ],
    activityRows: [{ iri: ACT_2, usage: 'Object' }],
  };

  // C: anonymous group actor (no IFI). lrsql writes member rows ONLY — no row
  // for the group itself.
  const stmtC: SeedStatement = {
    statementId: SC,
    registration: null,
    verbIri: 'http://example.com/verbs/attempted',
    timestamp: ts(3),
    stored: ts(3),
    payload: {
      id: SC,
      actor: {
        objectType: 'Group',
        member: [
          { objectType: 'Agent', mbox: 'mailto:anon1@example.com', name: 'Anon One' },
          { objectType: 'Agent', mbox: 'mailto:anon2@example.com', name: 'Anon Two' },
        ],
      },
      verb: { id: 'http://example.com/verbs/attempted', display: { 'en-US': 'attempted' } },
      object: { objectType: 'Activity', id: ACT_3 },
      authority,
      stored: ts(3),
      timestamp: ts(3),
      version: '1.0.0',
    },
    actorRows: [
      { ifi: ifi('mailto:anon1@example.com'), type: 'Agent', usage: 'Actor' },
      { ifi: ifi('mailto:anon2@example.com'), type: 'Agent', usage: 'Actor' },
    ],
    activityRows: [{ iri: ACT_3, usage: 'Object' }],
  };

  // D: substatement. Top-level actor under Actor; the substatement's actor and
  // (agent) object under the Sub* positional usages.
  const stmtD: SeedStatement = {
    statementId: SD,
    registration: null,
    verbIri: 'http://example.com/verbs/planned',
    timestamp: ts(4),
    stored: ts(4),
    payload: {
      id: SD,
      actor: { objectType: 'Agent', mbox: 'mailto:main@example.com', name: 'Main Actor' },
      verb: { id: 'http://example.com/verbs/planned', display: { 'en-US': 'planned' } },
      object: {
        objectType: 'SubStatement',
        actor: { objectType: 'Agent', mbox: 'mailto:subactor@example.com', name: 'Sub Actor' },
        verb: { id: 'http://example.com/verbs/subbed', display: { 'en-US': 'subbed' } },
        object: { objectType: 'Agent', mbox: 'mailto:subobject@example.com', name: 'Sub Object' },
      },
      authority,
      stored: ts(4),
      timestamp: ts(4),
      version: '1.0.0',
    },
    actorRows: [
      { ifi: ifi('mailto:main@example.com'), type: 'Agent', usage: 'Actor' },
      { ifi: ifi('mailto:subactor@example.com'), type: 'Agent', usage: 'SubActor' },
      { ifi: ifi('mailto:subobject@example.com'), type: 'Agent', usage: 'SubObject' },
    ],
    activityRows: [],
  };

  return [stmtA, stmtB, stmtC, stmtD];
}

async function seedLrsqlDatabase(db: PGlite): Promise<void> {
  // --- Admin accounts (neither ports) ---
  const buddyId = randomUUID();
  await db.query(`INSERT INTO admin_account (id, username, passhash) VALUES ($1, $2, $3)`, [
    buddyId,
    BUDDY_USERNAME,
    BUDDY_PASSHASH,
  ]);
  await db.query(`INSERT INTO admin_account (id, username, passhash, oidc_issuer) VALUES ($1, $2, NULL, $3)`, [
    randomUUID(),
    OIDC_USERNAME,
    'https://accounts.example.com',
  ]);

  // --- Credential + composite-keyed scopes (one 'all', one NULL) ---
  await db.query(
    `INSERT INTO lrs_credential (id, api_key, secret_key, account_id, label) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), API_KEY, SECRET_KEY, buddyId, 'Seeded lrsql credential'],
  );
  await db.query(
    `INSERT INTO credential_to_scope (id, api_key, secret_key, scope) VALUES ($1, $2, $3, $4::scope_enum)`,
    [randomUUID(), API_KEY, SECRET_KEY, 'all'],
  );
  await db.query(`INSERT INTO credential_to_scope (id, api_key, secret_key, scope) VALUES ($1, $2, $3, NULL)`, [
    randomUUID(),
    API_KEY,
    SECRET_KEY,
  ]);

  // --- Entity rows (actor / activity) referenced by the junctions ---
  for (const a of SEED_ACTORS) {
    await db.query(`INSERT INTO actor (id, actor_ifi, actor_type, payload) VALUES ($1, $2, $3::actor_type_enum, $4)`, [
      randomUUID(),
      a.ifi,
      a.type,
      JSON.stringify(a.name ? { name: a.name } : {}),
    ]);
  }
  for (const iriVal of [ACT_1, ACT_2, ACT_3]) {
    await db.query(`INSERT INTO activity (id, activity_iri, payload) VALUES ($1, $2, $3)`, [
      randomUUID(),
      iriVal,
      JSON.stringify({ objectType: 'Activity', id: iriVal }),
    ]);
  }

  // --- Statements + junction rows ---
  const statements = buildSeedStatements();
  for (const [i, s] of statements.entries()) {
    // Row PK: time-ordered SQUUID with a 2021 prefix, so any statement we
    // POST later (2026-era prefix) sorts strictly AFTER every seeded row.
    const rowId = squuid(Date.UTC(2021, 0, 1) + i * 1000);
    await db.query(
      `INSERT INTO xapi_statement
         (id, statement_id, registration, verb_iri, is_voided, payload, timestamp, stored)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7)`,
      [rowId, s.statementId, s.registration, s.verbIri, JSON.stringify(s.payload), s.timestamp, s.stored],
    );
    for (const r of s.actorRows) {
      await db.query(
        `INSERT INTO statement_to_actor (id, statement_id, usage, actor_ifi, actor_type)
         VALUES ($1, $2, $3::actor_usage_enum, $4, $5::actor_type_enum)`,
        [randomUUID(), s.statementId, r.usage, r.ifi, r.type],
      );
    }
    for (const r of s.activityRows) {
      await db.query(
        `INSERT INTO statement_to_activity (id, statement_id, usage, activity_iri)
         VALUES ($1, $2, $3::activity_usage_enum, $4)`,
        [randomUUID(), s.statementId, r.usage, r.iri],
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Catalog snapshot helpers (mirrors schema-parity.test.ts) — to prove the
// committed migration is a schema no-op on a live lrsql database except for
// adding the SSE trigger.
// ---------------------------------------------------------------------------

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

interface CatalogRow {
  kind: string;
  name: string;
  pos: string;
  detail: string | null;
}

async function catalogSnapshot(db: PGlite): Promise<CatalogRow[]> {
  const { rows } = await db.query<CatalogRow>(CATALOG_SQL);
  // The pglite migration-tracker table is a provisioning artifact of the
  // takeover step, not part of lrsql's schema — exclude it from the diff.
  return rows
    .filter((r) => !r.name.includes('_pglite_migrations'))
    .sort((a, b) => {
      for (const key of ['kind', 'name', 'pos', 'detail'] as const) {
        const av = a[key] ?? '';
        const bv = b[key] ?? '';
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return 0;
    });
}

async function xapiStatementTriggerNames(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ tgname: string }>(
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'xapi_statement'::regclass AND NOT tgisinternal
      ORDER BY tgname`,
  );
  return rows.map((r) => r.tgname);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('lrsql takeover (end to end)', () => {
  let db: PGlite;
  let server: LrsTestServerHandle;
  let preMigrationCatalog: CatalogRow[];
  let preMigrationTriggers: string[];

  beforeAll(async () => {
    // 1. Live lrsql database: upstream DDL, then lrsql-shaped seed data.
    db = new PGlite();
    await applyUpstreamLrsqlDdl(db);
    await seedLrsqlDatabase(db);

    // 2. Snapshot the schema as lrsql left it (pre-takeover).
    preMigrationCatalog = await catalogSnapshot(db);
    preMigrationTriggers = await xapiStatementTriggerNames(db);

    // 3. Takeover: injecting the instance makes createPgliteBackend run the
    //    committed migration on top of the live lrsql database, then boot the
    //    app against it.
    server = await createLrsTestServer({ pgliteInstance: db });
  }, 60_000);

  afterAll(async () => {
    // server.close() ends the pool, which closes the injected PGlite instance.
    await server?.close();
  });

  test('the takeover migration is a schema no-op except for adding the SSE trigger', async () => {
    const postMigrationCatalog = await catalogSnapshot(db);
    const postMigrationTriggers = await xapiStatementTriggerNames(db);

    // A live lrsql database has no triggers; the takeover adds exactly ours.
    expect(preMigrationTriggers).toEqual([]);
    expect(postMigrationTriggers).toEqual(['trg_xapi_statement_stored']);

    // Everything else — every column, constraint, index, enum label — is
    // unchanged by the takeover.
    expect(postMigrationCatalog).toEqual(preMigrationCatalog);
    // Guard against a vacuous pass if CATALOG_SQL ever degraded.
    expect(postMigrationCatalog.length).toBeGreaterThan(150);
  });

  test('authenticated xAPI GET succeeds with the seeded lrsql credential (field issue 1)', async () => {
    // This exact path — auth against composite-keyed scopes on an lrsql
    // database — 500'd in v0.5.1.
    const res = await fetch(`${server.apiUrl}/xapi/statements?limit=50`, {
      headers: { ...V, Authorization: `Basic ${SEEDED_AUTH}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { statements: Array<{ id: string }> };
    const ids = body.statements.map((s) => s.id);
    // All four seeded statements are readable.
    for (const id of SEEDED_STATEMENT_IDS) {
      expect(ids).toContain(id);
    }
  });

  test('seeded statements are retrievable by statementId', async () => {
    for (const id of SEEDED_STATEMENT_IDS) {
      const res = await fetch(`${server.apiUrl}/xapi/statements?statementId=${id}`, {
        headers: { ...V, Authorization: `Basic ${SEEDED_AUTH}` },
      });
      expect(res.status, `statementId=${id}`).toBe(200);
      const stmt = (await res.json()) as { id: string };
      expect(stmt.id).toBe(id);
    }
  });

  test('agent filter matches a decomposed group member (usage Actor)', async () => {
    // member1 is only ever a MEMBER of statement B's identified group actor —
    // it is retrievable by a plain agent filter because lrsql writes members
    // under the group's Actor usage.
    const agent = JSON.stringify({ mbox: 'mailto:member1@example.com' });
    const res = await fetch(`${server.apiUrl}/xapi/statements?agent=${encodeURIComponent(agent)}`, {
      headers: { ...V, Authorization: `Basic ${SEEDED_AUTH}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { statements: Array<{ id: string }> };
    const ids = body.statements.map((s) => s.id);
    expect(ids).toEqual([SB]);
  });

  test('related_agents matches context team/instructor members', async () => {
    // instructor1 (context.instructor member, usage Instructor) is NOT an
    // Actor-position agent — a plain agent filter must miss it, but
    // related_agents (any-usage) must find statement A.
    const instructor = JSON.stringify({ mbox: 'mailto:instructor1@example.com' });

    const plain = await fetch(`${server.apiUrl}/xapi/statements?agent=${encodeURIComponent(instructor)}`, {
      headers: { ...V, Authorization: `Basic ${SEEDED_AUTH}` },
    });
    expect(plain.status).toBe(200);
    expect(((await plain.json()) as { statements: unknown[] }).statements).toHaveLength(0);

    const related = await fetch(
      `${server.apiUrl}/xapi/statements?agent=${encodeURIComponent(instructor)}&related_agents=true`,
      { headers: { ...V, Authorization: `Basic ${SEEDED_AUTH}` } },
    );
    expect(related.status).toBe(200);
    const relatedIds = ((await related.json()) as { statements: Array<{ id: string }> }).statements.map((s) => s.id);
    expect(relatedIds).toContain(SA);

    // A context.team member (usage Team) is likewise reachable via related_agents.
    const teammate = JSON.stringify({ mbox: 'mailto:teammate1@example.com' });
    const teamRes = await fetch(
      `${server.apiUrl}/xapi/statements?agent=${encodeURIComponent(teammate)}&related_agents=true`,
      { headers: { ...V, Authorization: `Basic ${SEEDED_AUTH}` } },
    );
    expect(teamRes.status).toBe(200);
    const teamIds = ((await teamRes.json()) as { statements: Array<{ id: string }> }).statements.map((s) => s.id);
    expect(teamIds).toContain(SA);
  });

  test('lrsql admin passhashes fail auth cleanly (401, not 500); a fresh admin still works', async () => {
    const adminEndpoint = `${server.apiUrl}/api/admin/credentials`;

    // Buddy-format passhash: cannot verify → 401 (never a 500).
    const buddy = await fetch(adminEndpoint, {
      headers: { Authorization: `Basic ${Buffer.from(`${BUDDY_USERNAME}:anything`).toString('base64')}` },
    });
    expect(buddy.status).toBe(401);

    // NULL passhash (OIDC-only account): also 401.
    const oidc = await fetch(adminEndpoint, {
      headers: { Authorization: `Basic ${Buffer.from(`${OIDC_USERNAME}:anything`).toString('base64')}` },
    });
    expect(oidc.status).toBe(401);

    // A freshly-bootstrapped admin (app-side bcrypt, as env-var bootstrap does
    // via createAccount) authenticates cleanly alongside the non-portable ones.
    const freshPassword = randomUUID();
    await createAccount(server.pool, createMetrics(), 'fresh-admin', freshPassword);
    const fresh = await fetch(adminEndpoint, {
      headers: { Authorization: `Basic ${Buffer.from(`fresh-admin:${freshPassword}`).toString('base64')}` },
    });
    expect(fresh.status).toBe(200);

    // The buddy account still can't authenticate — the fresh account didn't
    // shadow it.
    const buddyAgain = await fetch(adminEndpoint, {
      headers: { Authorization: `Basic ${Buffer.from(`${BUDDY_USERNAME}:anything`).toString('base64')}` },
    });
    expect(buddyAgain.status).toBe(401);
  });

  test('our writes round-trip in lrsql shape and re-POSTs do not duplicate junctions', async () => {
    const rtReg = randomUUID();
    const rtTimestamp = new Date().toISOString();
    // Identified group actor with two members — exercises positional-usage
    // decomposition on the write path.
    const rtBody: Record<string, unknown> = {
      actor: {
        objectType: 'Group',
        mbox: 'mailto:rt-team@example.com',
        name: 'RT Team',
        member: [
          { objectType: 'Agent', mbox: 'mailto:rt-m1@example.com' },
          { objectType: 'Agent', mbox: 'mailto:rt-m2@example.com' },
        ],
      },
      verb: { id: 'http://example.com/verbs/completed', display: { 'en-US': 'completed' } },
      object: { objectType: 'Activity', id: 'http://example.com/activities/rt-act' },
      context: { registration: rtReg },
      timestamp: rtTimestamp,
    };

    const headers = { ...V, 'Content-Type': 'application/json', Authorization: `Basic ${SEEDED_AUTH}` };

    // POST WITHOUT an id so the server generates the statement_id (UUIDv7).
    const postRes = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rtBody),
    });
    expect(postRes.status).toBe(200);
    const [genId] = (await postRes.json()) as string[];
    expect(genId).toBeTruthy();

    // --- Direct SQL assertions on the taken-over database ---
    const { rows } = await db.query<{
      id: string;
      statement_id: string;
      registration: string | null;
      verb_iri: string;
      is_voided: boolean;
      payload: unknown;
      timestamp: string | null;
      stored: string | null;
    }>(
      `SELECT id, statement_id, registration, verb_iri, is_voided, payload, timestamp, stored
         FROM xapi_statement WHERE statement_id = $1`,
      [genId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // Explicit columns lrsql treats as required / populated on write.
    expect(row.registration).toBe(rtReg);
    expect(row.timestamp).not.toBeNull();
    expect(new Date(row.timestamp as string).getTime()).toBe(new Date(rtTimestamp).getTime());
    expect(row.stored).not.toBeNull();
    expect(row.verb_iri).toBe('http://example.com/verbs/completed');
    expect(row.is_voided).toBe(false);
    expect(row.payload).not.toBeNull();
    expect(row.statement_id).not.toBeNull();

    // statement_id parses as a UUID version 7 (the 13th hex digit, position 14
    // including dashes, is the version nibble).
    expect(genId.charAt(14)).toBe('7');

    // Row PK is time-ordered and sorts strictly AFTER every seeded row id.
    const { rows: seededRows } = await db.query<{ id: string }>(
      `SELECT id FROM xapi_statement WHERE statement_id = ANY($1::uuid[])`,
      [SEEDED_STATEMENT_IDS],
    );
    expect(seededRows).toHaveLength(SEEDED_STATEMENT_IDS.length);
    for (const seeded of seededRows) {
      expect(row.id > seeded.id, `new id ${row.id} should sort after seeded id ${seeded.id}`).toBe(true);
    }

    // Group members decomposed with the group's positional usage: the group
    // row (Group) plus each member (Agent), all under the Actor usage. (The
    // server also writes an Authority row from the credential's auth agent —
    // filtered out here, asserted via the total count below.)
    const { rows: actorRows } = await db.query<{ usage: string; actor_ifi: string; actor_type: string }>(
      `SELECT usage, actor_ifi, actor_type FROM statement_to_actor
        WHERE statement_id = $1 AND usage = 'Actor' ORDER BY actor_ifi`,
      [genId],
    );
    expect(actorRows).toHaveLength(3);
    for (const r of actorRows) {
      expect(r.usage).toBe('Actor');
    }
    expect(actorRows.map((r) => `${r.actor_type}:${r.actor_ifi}`).sort()).toEqual(
      [
        `Group:${ifi('mailto:rt-team@example.com')}`,
        `Agent:${ifi('mailto:rt-m1@example.com')}`,
        `Agent:${ifi('mailto:rt-m2@example.com')}`,
      ].sort(),
    );

    const junctionCount = async (): Promise<number> => {
      const { rows: c } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM statement_to_actor WHERE statement_id = $1`,
        [genId],
      );
      return c[0].n;
    };
    // 3 actor-position rows + 1 authority row.
    const countAfterFirstPost = await junctionCount();
    expect(countAfterFirstPost).toBe(4);

    // Re-POST the SAME statement (now carrying the assigned id): accepted
    // (200, not 409), and no duplicate junction rows accumulate — lrsql's
    // junction tables have no unique constraint, so gating on the statement
    // insert is what prevents accumulation.
    const rePost = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...rtBody, id: genId }),
    });
    expect(rePost.status).toBe(200);
    expect(await junctionCount()).toBe(countAfterFirstPost);
  });
});
