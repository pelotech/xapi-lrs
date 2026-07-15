/*
 * Flattened lrsql v0.9.5 PostgreSQL schema (end-state after all in-file
 * migrations in src/db/postgres/lrsql/postgres/sql/ddl.sql have run).
 *
 * Idempotent: safe to run on an empty database AND on a live, fully-migrated
 * lrsql v0.9.5 database. Constraint and index names match lrsql exactly.
 *
 * NOT covered (by design): data-bearing conversions for PARTIALLY-migrated
 * pre-2024 lrsql databases (VARCHAR->TEXT column conversions, JSON/JSONB
 * round-trip, last_modified TIMESTAMP->TIMESTAMPTZ tz-shift). Those require
 * lrsql's own migration runner (and its :sql:tz-id parameter). This script
 * assumes the DB is either empty or already at the v0.9.5 end state; it does,
 * however, converge the purely-additive migrations (added columns, added FKs,
 * enum rebuilds, statement_fk cascade) if they are missing.
 */

/* ---------------------------------------------------------------------- */
/* Enums                                                                  */
/* ---------------------------------------------------------------------- */

DO $$ BEGIN
  CREATE TYPE actor_type_enum AS ENUM ('Agent', 'Group');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Final actor_usage_enum (base 9 values + 2025-09-26 migration adding
-- ContextAgent, ContextGroup, SubContextAgent, SubContextGroup).
-- If an old 9-value enum exists, rebuild it via lrsql's circuitous route.
DO $$ BEGIN
  IF to_regtype('actor_usage_enum') IS NULL THEN
    CREATE TYPE actor_usage_enum AS ENUM (
      'Actor', 'Object', 'Authority', 'Instructor', 'Team',
      'SubActor', 'SubObject', 'SubInstructor', 'SubTeam',
      'ContextAgent', 'ContextGroup', 'SubContextAgent', 'SubContextGroup');
  ELSIF NOT (enum_range(NULL::actor_usage_enum)::TEXT[] @> ARRAY['ContextAgent']) THEN
    ALTER TABLE IF EXISTS statement_to_actor ALTER COLUMN usage TYPE VARCHAR(255);
    DROP TYPE actor_usage_enum;
    CREATE TYPE actor_usage_enum AS ENUM (
      'Actor', 'Object', 'Authority', 'Instructor', 'Team',
      'SubActor', 'SubObject', 'SubInstructor', 'SubTeam',
      'ContextAgent', 'ContextGroup', 'SubContextAgent', 'SubContextGroup');
    ALTER TABLE IF EXISTS statement_to_actor
      ALTER COLUMN usage TYPE actor_usage_enum USING (usage::actor_usage_enum);
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_usage_enum AS ENUM (
      'Object', 'Category', 'Grouping', 'Parent', 'Other',
      'SubObject', 'SubCategory', 'SubGrouping', 'SubParent', 'SubOther');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Final scope_enum (2024-01-24 migration end state; order matters and is
-- checked with the same order-sensitive equality lrsql's guard query uses).
DO $$ BEGIN
  IF to_regtype('scope_enum') IS NULL THEN
    CREATE TYPE scope_enum AS ENUM (
      'statements/write',
      'statements/read',
      'statements/read/mine',
      'all/read',
      'all',
      'state',
      'state/read',
      'define',
      'activities_profile',
      'activities_profile/read',
      'agents_profile',
      'agents_profile/read');
  ELSIF NOT (enum_range(NULL::scope_enum)::TEXT[]
             = ARRAY[
               'statements/write',
               'statements/read',
               'statements/read/mine',
               'all/read',
               'all',
               'state',
               'state/read',
               'define',
               'activities_profile',
               'activities_profile/read',
               'agents_profile',
               'agents_profile/read']) THEN
    ALTER TABLE IF EXISTS credential_to_scope ALTER COLUMN scope TYPE VARCHAR(255);
    DROP TYPE scope_enum;
    CREATE TYPE scope_enum AS ENUM (
      'statements/write',
      'statements/read',
      'statements/read/mine',
      'all/read',
      'all',
      'state',
      'state/read',
      'define',
      'activities_profile',
      'activities_profile/read',
      'agents_profile',
      'agents_profile/read');
    ALTER TABLE IF EXISTS credential_to_scope
      ALTER COLUMN scope TYPE scope_enum USING (scope::scope_enum);
  END IF;
END $$;

/* ---------------------------------------------------------------------- */
/* Reaction table (created before xapi_statement, which FKs it)           */
/* ---------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS reaction (
  id       UUID PRIMARY KEY,
  title    TEXT NOT NULL UNIQUE,          -- unique constraint: reaction_title_key
  ruleset  JSON NOT NULL,
  created  TIMESTAMP NOT NULL,            -- note: WITHOUT time zone in lrsql
  modified TIMESTAMP NOT NULL,            -- note: WITHOUT time zone in lrsql
  active   BOOLEAN,
  error    JSON
);

/* ---------------------------------------------------------------------- */
/* Statement + Attachment tables                                          */
/* ---------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS xapi_statement (
  id           UUID PRIMARY KEY,
  statement_id UUID NOT NULL UNIQUE,      -- unique constraint: xapi_statement_statement_id_key
  registration UUID,
  verb_iri     TEXT NOT NULL,
  is_voided    BOOLEAN DEFAULT FALSE NOT NULL,
  payload      JSON NOT NULL,             -- JSON, not JSONB (final lrsql state)
  timestamp    TIMESTAMPTZ,               -- added by migration 2023-05-08-00
  stored       TIMESTAMPTZ,               -- added by migration 2023-05-08-01
  reaction_id  UUID,                      -- added by migration 2023-07-21-00
  trigger_id   UUID,                      -- added by migration 2023-07-21-00
  CONSTRAINT stmt_reaction_id_fk
    FOREIGN KEY (reaction_id) REFERENCES reaction(id),
  CONSTRAINT stmt_trigger_id_fk
    FOREIGN KEY (trigger_id) REFERENCES xapi_statement(statement_id)
);
CREATE INDEX IF NOT EXISTS desc_id_idx ON xapi_statement(id DESC);
CREATE INDEX IF NOT EXISTS verb_iri_idx ON xapi_statement(verb_iri);
CREATE INDEX IF NOT EXISTS registration ON xapi_statement(registration);
CREATE INDEX IF NOT EXISTS stmt_reaction_id_idx ON xapi_statement(reaction_id);
CREATE INDEX IF NOT EXISTS stmt_trigger_id_idx ON xapi_statement(trigger_id);

-- Catch-up for pre-migration lrsql DBs (all no-ops on empty or v0.9.5 DBs).
ALTER TABLE xapi_statement ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ;
ALTER TABLE xapi_statement ADD COLUMN IF NOT EXISTS stored TIMESTAMPTZ;
ALTER TABLE xapi_statement ADD COLUMN IF NOT EXISTS reaction_id UUID;
ALTER TABLE xapi_statement ADD COLUMN IF NOT EXISTS trigger_id UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'stmt_reaction_id_fk'
                   AND conrelid = 'xapi_statement'::regclass) THEN
    ALTER TABLE xapi_statement ADD CONSTRAINT stmt_reaction_id_fk
      FOREIGN KEY (reaction_id) REFERENCES reaction(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'stmt_trigger_id_fk'
                   AND conrelid = 'xapi_statement'::regclass) THEN
    ALTER TABLE xapi_statement ADD CONSTRAINT stmt_trigger_id_fk
      FOREIGN KEY (trigger_id) REFERENCES xapi_statement(statement_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS actor (
  id         UUID PRIMARY KEY,
  actor_ifi  TEXT NOT NULL,
  actor_type actor_type_enum NOT NULL,
  payload    JSON NOT NULL,               -- JSON, not JSONB (final lrsql state)
  CONSTRAINT actor_idx UNIQUE (actor_ifi, actor_type)
);

CREATE TABLE IF NOT EXISTS activity (
  id           UUID PRIMARY KEY,
  activity_iri TEXT NOT NULL UNIQUE,      -- unique constraint: activity_activity_iri_key
  payload      JSON NOT NULL              -- JSON, not JSONB (final lrsql state)
);

CREATE TABLE IF NOT EXISTS attachment (
  id             UUID PRIMARY KEY,
  statement_id   UUID NOT NULL,
  attachment_sha TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  content_length INTEGER NOT NULL,
  contents       BYTEA NOT NULL,
  CONSTRAINT statement_fk
    FOREIGN KEY (statement_id) REFERENCES xapi_statement(statement_id)
    -- NO cascade: the 2023 cascade migration only touched statement_to_actor
);
CREATE INDEX IF NOT EXISTS attachment_stmt_fk ON attachment(statement_id);

CREATE TABLE IF NOT EXISTS statement_to_actor (
  id           UUID PRIMARY KEY,
  statement_id UUID NOT NULL,
  usage        actor_usage_enum NOT NULL,
  actor_ifi    TEXT NOT NULL,
  actor_type   actor_type_enum NOT NULL,
  CONSTRAINT statement_fk
    FOREIGN KEY (statement_id) REFERENCES xapi_statement(statement_id)
    ON DELETE CASCADE,                    -- cascade added by 2023 migration
  CONSTRAINT actor_fk
    FOREIGN KEY (actor_ifi, actor_type) REFERENCES actor(actor_ifi, actor_type)
);
CREATE INDEX IF NOT EXISTS stmt_actor_stmt_fk ON statement_to_actor(statement_id);
CREATE INDEX IF NOT EXISTS stmt_actor_actor_fk ON statement_to_actor(actor_ifi, actor_type);

-- Catch-up: ensure statement_to_actor.statement_fk has ON DELETE CASCADE.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'statement_fk'
               AND conrelid = 'statement_to_actor'::regclass
               AND confdeltype <> 'c') THEN
    ALTER TABLE statement_to_actor DROP CONSTRAINT statement_fk;
    ALTER TABLE statement_to_actor ADD CONSTRAINT statement_fk
      FOREIGN KEY (statement_id) REFERENCES xapi_statement(statement_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS statement_to_activity (
  id           UUID PRIMARY KEY,
  statement_id UUID NOT NULL,
  usage        activity_usage_enum NOT NULL,
  activity_iri TEXT NOT NULL,
  CONSTRAINT statement_fk
    FOREIGN KEY (statement_id) REFERENCES xapi_statement(statement_id),
    -- NO cascade (never migrated)
  CONSTRAINT activity_fk
    FOREIGN KEY (activity_iri) REFERENCES activity(activity_iri)
);
CREATE INDEX IF NOT EXISTS stmt_activ_stmt_fk ON statement_to_activity(statement_id);
CREATE INDEX IF NOT EXISTS stmt_activ_activ_fk ON statement_to_activity(activity_iri);

CREATE TABLE IF NOT EXISTS statement_to_statement (
  id            UUID PRIMARY KEY,
  ancestor_id   UUID NOT NULL,
  descendant_id UUID NOT NULL,
  CONSTRAINT ancestor_fk
    FOREIGN KEY (ancestor_id) REFERENCES xapi_statement(statement_id),
  CONSTRAINT descendant_fk
    FOREIGN KEY (descendant_id) REFERENCES xapi_statement(statement_id)
);
CREATE INDEX IF NOT EXISTS stmt_stmt_ans_fk ON statement_to_statement(ancestor_id);
CREATE INDEX IF NOT EXISTS stmt_stmt_desc_fk ON statement_to_statement(descendant_id);

/* ---------------------------------------------------------------------- */
/* Document tables                                                        */
/* ---------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS state_document (
  id             UUID PRIMARY KEY,
  state_id       TEXT NOT NULL,
  activity_iri   TEXT NOT NULL,
  agent_ifi      TEXT NOT NULL,
  registration   UUID DEFAULT NULL,
  last_modified  TIMESTAMPTZ NOT NULL,    -- tz added by migration 2023-05-11-00
  content_type   TEXT NOT NULL,
  content_length INTEGER NOT NULL,
  contents       BYTEA NOT NULL,
  CONSTRAINT state_doc_idx
    UNIQUE (state_id, activity_iri, agent_ifi, registration)
);

-- NOTE: lrsql's 2024-05-29 VARCHAR->TEXT migration SKIPS this table entirely;
-- its string columns remain VARCHAR(255) even on a fully migrated database.
CREATE TABLE IF NOT EXISTS agent_profile_document (
  id             UUID PRIMARY KEY,
  profile_id     VARCHAR(255) NOT NULL,
  agent_ifi      VARCHAR(255) NOT NULL,
  last_modified  TIMESTAMPTZ NOT NULL,    -- tz added by migration 2023-05-11-00
  content_type   VARCHAR(255) NOT NULL,
  content_length INTEGER NOT NULL,
  contents       BYTEA NOT NULL,
  CONSTRAINT agent_profile_doc_idx
    UNIQUE (profile_id, agent_ifi)
);

CREATE TABLE IF NOT EXISTS activity_profile_document (
  id             UUID PRIMARY KEY,
  profile_id     TEXT NOT NULL,
  activity_iri   TEXT NOT NULL,
  last_modified  TIMESTAMPTZ NOT NULL,    -- tz added by migration 2023-05-11-00
  content_type   TEXT NOT NULL,
  content_length INTEGER NOT NULL,
  contents       BYTEA NOT NULL,
  CONSTRAINT activity_profile_doc_idx
    UNIQUE (profile_id, activity_iri)
);

/* ---------------------------------------------------------------------- */
/* Admin account + credential tables                                      */
/* ---------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS admin_account (
  id          UUID PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,       -- unique constraint: admin_account_username_key
  passhash    TEXT,                       -- NOT NULL dropped by migration 2022-02-22-00
  oidc_issuer TEXT                        -- added by migration 2022-02-23-00
);
-- Catch-up (no-ops on empty or v0.9.5 DBs).
ALTER TABLE IF EXISTS admin_account ALTER COLUMN passhash DROP NOT NULL;
ALTER TABLE IF EXISTS admin_account ADD COLUMN IF NOT EXISTS oidc_issuer TEXT;

CREATE TABLE IF NOT EXISTS lrs_credential (
  id         UUID PRIMARY KEY,
  api_key    TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  account_id UUID NOT NULL,
  label      TEXT,                        -- added by migration 2025-03-21
  is_seed    BOOLEAN,                     -- added by migration 2025-03-21
  CONSTRAINT credential_idx
    UNIQUE (api_key, secret_key),
  CONSTRAINT account_fk
    FOREIGN KEY (account_id)
    REFERENCES admin_account(id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cred_account_fk ON lrs_credential(account_id);
-- Catch-up.
ALTER TABLE lrs_credential ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE lrs_credential ADD COLUMN IF NOT EXISTS is_seed BOOLEAN;

CREATE TABLE IF NOT EXISTS credential_to_scope (
  id         UUID PRIMARY KEY,
  api_key    TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  scope      scope_enum,                  -- nullable
  CONSTRAINT credential_fk
    FOREIGN KEY (api_key, secret_key)
    REFERENCES lrs_credential(api_key, secret_key)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cred_keypair_fk ON credential_to_scope(api_key, secret_key);

/* ---------------------------------------------------------------------- */
/* JWT blocklist table                                                    */
/* ---------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS blocked_jwt (
  jwt         TEXT PRIMARY KEY,
  evict_time  TIMESTAMPTZ,
  one_time_id UUID UNIQUE                 -- added by migration 2025-03-05;
                                          -- unique constraint: blocked_jwt_one_time_id_key
);
CREATE INDEX IF NOT EXISTS blocked_jwt_evict_time_idx ON blocked_jwt(evict_time);
-- Catch-up.
ALTER TABLE IF EXISTS blocked_jwt ADD COLUMN IF NOT EXISTS one_time_id UUID UNIQUE;
