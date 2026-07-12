/**
 * Startup schema probe. Verifies the connected database has the lrsql-shaped
 * schema this release requires, and fails fast with an actionable message
 * otherwise (field issue 1 was this failure surfacing as a runtime 500).
 */
import type { DbPool } from './db.ts';

export class SchemaProbeError extends Error {}

// Column-existence checks go through pg_catalog rather than
// information_schema.columns: the latter is privilege-filtered (a column only
// appears if the current role holds some privilege on it), so a
// least-privilege / separate-migration-role deployment could false-negative on
// a valid database. to_regclass is already privilege-agnostic; going
// all-pg_catalog keeps the whole probe consistent.
const COLUMN_EXISTS = (table: string, column: string) => `
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
              JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
             WHERE n.nspname = 'public' AND c.relname = '${table}'
               AND a.attname = '${column}' AND a.attnum > 0 AND NOT a.attisdropped)`;

const MARKERS_SQL = `
  SELECT
    to_regclass('public.xapi_statement') IS NOT NULL                       AS has_statement_table,
    ${COLUMN_EXISTS('credential_to_scope', 'api_key')}                      AS scopes_by_keypair,
    ${COLUMN_EXISTS('credential_to_scope', 'credential_id')}               AS scopes_by_credential_id,
    ${COLUMN_EXISTS('xapi_statement', 'registration')}                     AS statement_has_registration
`;

interface SchemaMarkers {
  has_statement_table: boolean;
  scopes_by_keypair: boolean;
  scopes_by_credential_id: boolean;
  statement_has_registration: boolean;
}

export async function probeSchema(pool: DbPool): Promise<void> {
  // DbPool.query takes a QueryConfig (src/db.ts:22); a bare string breaks the
  // pglite adapter, which dereferences config.text (src/db-pglite.ts:84).
  const {
    rows: [m],
  } = await pool.query<SchemaMarkers>({ text: MARKERS_SQL });
  // A valid lrsql-shaped DB has the keypair scope column and NO credential_id
  // column. A schema carrying BOTH (a partial / hand-run migration) is
  // ambiguous — exactly what this gate exists to catch — so it must fall
  // through to the pre-0.6 / generic-mismatch branches rather than false-pass.
  if (m.has_statement_table && m.scopes_by_keypair && !m.scopes_by_credential_id && m.statement_has_registration)
    return;
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
