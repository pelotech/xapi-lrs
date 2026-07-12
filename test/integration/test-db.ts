/**
 * Test Database Utilities for LRS integration tests.
 *
 * Creates an isolated lrsql-compatible schema in a test database.
 * No tenants, no RLS — pure single-tenant lrsql model.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { DbPool } from '../../src/db.ts';

const { Pool } = pg;

export interface TestDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** Default test DB config — uses env vars or sensible defaults. */
export const defaultTestDbConfig: TestDbConfig = {
  host: process.env['TEST_DB_HOST'] ?? process.env['PGHOST'] ?? 'localhost',
  port: parseInt(process.env['LRS_TEST_DB_PORT'] ?? process.env['TEST_DB_PORT'] ?? process.env['PGPORT'] ?? '5432', 10),
  database: process.env['LRS_TEST_DB_NAME'] ?? process.env['TEST_DB_NAME'] ?? process.env['PGDATABASE'] ?? 'xapi_lrs',
  user: process.env['LRS_TEST_DB_USER'] ?? process.env['TEST_DB_USER'] ?? process.env['PGUSER'] ?? 'test',
  password:
    process.env['LRS_TEST_DB_PASSWORD'] ?? process.env['TEST_DB_PASSWORD'] ?? process.env['PGPASSWORD'] ?? 'test',
};

export function createTestPool(config: TestDbConfig = defaultTestDbConfig): pg.Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 5,
  });
}

export function testConnectionString(config: TestDbConfig = defaultTestDbConfig): string {
  return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
}

/** Apply the lrsql schema DDL (the committed migration — single source of truth). */
export async function applyLrsqlSchema(pool: pg.Pool): Promise<void> {
  const ddl = readFileSync(join(import.meta.dirname, '../../db/migrations/committed/000001-lrsql-schema.sql'), 'utf8');
  await pool.query(ddl);
}

const TRUNCATE_SQL = `
  TRUNCATE
    attachment,
    statement_to_statement,
    statement_to_activity,
    statement_to_actor,
    xapi_statement,
    activity,
    actor,
    state_document,
    activity_profile_document,
    agent_profile_document,
    credential_to_scope,
    lrs_credential,
    admin_account,
    reaction,
    blocked_jwt
  CASCADE
`;

/** Truncate all lrsql tables (for test isolation). Works with pg or PGlite pools. */
export async function truncateLrsqlTables(pool: DbPool | pg.Pool): Promise<void> {
  await (pool as DbPool).query({ text: TRUNCATE_SQL });
}
