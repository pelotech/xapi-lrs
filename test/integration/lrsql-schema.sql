-- lrsql-compatible PostgreSQL schema for LRS integration tests.
-- Tables in public schema, matching lrsql's DDL exactly.

-- ============================================================================
-- Enums
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE scope_enum AS ENUM (
    'statements/write',
    'statements/read',
    'statements/read/mine',
    'all/read',
    'all',
    'define',
    'profile',
    'state',
    'state/read'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_type_enum AS ENUM ('Agent', 'Group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_usage_enum AS ENUM (
    'Actor', 'Object', 'Authority', 'Instructor', 'Team', 'Member'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_usage_enum AS ENUM (
    'Object', 'Category', 'Grouping', 'Parent', 'Other',
    'SubObject', 'SubCategory', 'SubGrouping', 'SubParent', 'SubOther'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Auth tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_account (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username    text NOT NULL UNIQUE,
  passhash    text NOT NULL
);

CREATE TABLE IF NOT EXISTS lrs_credential (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key     text NOT NULL,
  secret_key  text NOT NULL,
  account_id  uuid NOT NULL REFERENCES admin_account(id) ON DELETE CASCADE,
  UNIQUE (api_key, secret_key)
);

CREATE TABLE IF NOT EXISTS credential_to_scope (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES lrs_credential(id) ON DELETE CASCADE,
  scope         scope_enum NOT NULL,
  UNIQUE (credential_id, scope)
);

-- ============================================================================
-- Entity tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS actor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload     json NOT NULL DEFAULT '{}',
  actor_ifi   text NOT NULL,
  actor_type  actor_type_enum NOT NULL,
  UNIQUE (actor_ifi, actor_type)
);

CREATE TABLE IF NOT EXISTS activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload       json NOT NULL DEFAULT '{}',
  activity_iri  text NOT NULL UNIQUE
);

-- ============================================================================
-- Statement tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS xapi_statement (
  id            uuid PRIMARY KEY,
  statement_id  uuid NOT NULL UNIQUE,
  verb_iri      text NOT NULL,
  is_voided     boolean NOT NULL DEFAULT false,
  payload       json NOT NULL,
  stored        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xapi_statement_id_desc ON xapi_statement (id DESC);
CREATE INDEX IF NOT EXISTS idx_xapi_statement_verb ON xapi_statement (verb_iri);

CREATE TABLE IF NOT EXISTS statement_to_actor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id  uuid NOT NULL REFERENCES xapi_statement(statement_id) ON DELETE CASCADE,
  usage         actor_usage_enum NOT NULL,
  actor_ifi     text NOT NULL,
  actor_type    actor_type_enum NOT NULL,
  UNIQUE (statement_id, usage, actor_ifi)
);

CREATE INDEX IF NOT EXISTS idx_sta_actor_ifi ON statement_to_actor (actor_ifi);
CREATE INDEX IF NOT EXISTS idx_sta_stmt ON statement_to_actor (statement_id);

CREATE TABLE IF NOT EXISTS statement_to_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id  uuid NOT NULL REFERENCES xapi_statement(statement_id) ON DELETE CASCADE,
  usage         activity_usage_enum NOT NULL,
  activity_iri  text NOT NULL,
  UNIQUE (statement_id, usage, activity_iri)
);

CREATE INDEX IF NOT EXISTS idx_stact_activity_iri ON statement_to_activity (activity_iri);
CREATE INDEX IF NOT EXISTS idx_stact_stmt ON statement_to_activity (statement_id);

CREATE TABLE IF NOT EXISTS statement_to_statement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ancestor_id     uuid NOT NULL,
  descendant_id   uuid NOT NULL,
  UNIQUE (ancestor_id, descendant_id)
);

-- ============================================================================
-- Attachment table
-- ============================================================================

CREATE TABLE IF NOT EXISTS attachment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id    uuid NOT NULL REFERENCES xapi_statement(statement_id) ON DELETE CASCADE,
  attachment_sha  text NOT NULL,
  content_type    text NOT NULL,
  content_length  integer NOT NULL,
  contents        bytea NOT NULL,
  UNIQUE (statement_id, attachment_sha)
);

-- ============================================================================
-- Document tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS state_document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id        text NOT NULL,
  activity_iri    text NOT NULL,
  agent_ifi       text NOT NULL,
  registration    uuid,
  last_modified   timestamptz NOT NULL DEFAULT now(),
  content_type    text NOT NULL,
  content_length  integer NOT NULL,
  contents        bytea NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_state_document_unique
  ON state_document (state_id, activity_iri, agent_ifi, COALESCE(registration::text, ''));

CREATE TABLE IF NOT EXISTS activity_profile_document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      text NOT NULL,
  activity_iri    text NOT NULL,
  last_modified   timestamptz NOT NULL DEFAULT now(),
  content_type    text NOT NULL,
  content_length  integer NOT NULL,
  contents        bytea NOT NULL,
  UNIQUE (profile_id, activity_iri)
);

CREATE TABLE IF NOT EXISTS agent_profile_document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      text NOT NULL,
  agent_ifi       text NOT NULL,
  last_modified   timestamptz NOT NULL DEFAULT now(),
  content_type    text NOT NULL,
  content_length  integer NOT NULL,
  contents        bytea NOT NULL,
  UNIQUE (profile_id, agent_ifi)
);

-- ============================================================================
-- pg_notify trigger for SSE
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_xapi_statement_stored()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('xapi_statement_stored', json_build_object(
    'statement_id', NEW.statement_id,
    'id', NEW.id
  )::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_xapi_statement_stored ON xapi_statement;
CREATE TRIGGER trg_xapi_statement_stored
  AFTER INSERT ON xapi_statement
  FOR EACH ROW EXECUTE FUNCTION notify_xapi_statement_stored();
