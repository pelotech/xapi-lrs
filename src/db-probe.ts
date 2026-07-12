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
