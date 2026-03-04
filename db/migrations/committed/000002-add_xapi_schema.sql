--! Previous: sha1:a83ef742fb21ce54c862540a1b9f6808723cf40b
--! Hash: sha1:44591667b543fcbcd161d367c8ae18119d5f7504

CREATE SCHEMA IF NOT EXISTS xapi;

-- ---------------------------------------------------------------------------
-- Statements
-- ---------------------------------------------------------------------------

-- Immutable once stored. The `raw` column preserves the exact JSON received
-- so format=exact can return the original representation.

CREATE TABLE xapi.statements (
  tenant_id   UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
  id          UUID NOT NULL,
  verb_id     TEXT NOT NULL,
  actor_ifi   TEXT,                   -- canonical IFI string for indexing (NULL for anonymous groups)
  activity_id TEXT,                   -- object.id when object is an Activity
  registration UUID,                 -- context.registration
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  "timestamp" TIMESTAMPTZ NOT NULL,
  stored      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw         JSONB NOT NULL,         -- full Statement as received

  PRIMARY KEY (tenant_id, id)
);

-- ON CONFLICT (id) requires a unique constraint on id alone
CREATE UNIQUE INDEX idx_statements_id ON xapi.statements (id);
CREATE INDEX idx_statements_stored ON xapi.statements (tenant_id, stored);
CREATE INDEX idx_statements_verb ON xapi.statements (tenant_id, verb_id);
CREATE INDEX idx_statements_actor ON xapi.statements (tenant_id, actor_ifi);
CREATE INDEX idx_statements_activity ON xapi.statements (tenant_id, activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX idx_statements_registration ON xapi.statements (tenant_id, registration) WHERE registration IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Documents (State, Activity Profile, Agent Profile)
-- ---------------------------------------------------------------------------

-- Single table for all three document resources. The `resource` column
-- discriminates between them. Unused key columns default to '' (empty string)
-- rather than NULL so composite keys work on PG 17 without COALESCE:
--   state:            activity_id + agent_ifi + document_id + registration?
--   activity_profile: activity_id + document_id
--   agent_profile:    agent_ifi + document_id

CREATE TABLE xapi.documents (
  tenant_id     UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
  resource      TEXT NOT NULL CHECK (resource IN ('state', 'activity_profile', 'agent_profile')),
  activity_id   TEXT NOT NULL DEFAULT '',
  agent_ifi     TEXT NOT NULL DEFAULT '',
  registration  TEXT NOT NULL DEFAULT '',
  document_id   TEXT NOT NULL,
  content       BYTEA NOT NULL,
  content_type  TEXT NOT NULL,
  etag          TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tenant_id, resource, activity_id, agent_ifi, registration, document_id)
);

-- ON CONFLICT without tenant_id
CREATE UNIQUE INDEX idx_documents_conflict ON xapi.documents (resource, activity_id, agent_ifi, registration, document_id);
CREATE INDEX idx_documents_listing ON xapi.documents (tenant_id, resource, activity_id, agent_ifi, registration, updated_at);

-- ---------------------------------------------------------------------------
-- Activities (canonical definitions)
-- ---------------------------------------------------------------------------

-- Merged from Statements over time. When the LRS receives a Statement with
-- an Activity object that includes a definition, it merges the definition
-- into this table.

CREATE TABLE xapi.activities (
  tenant_id   UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  definition  JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tenant_id, id)
);

-- ON CONFLICT (id) requires a unique constraint on id alone
CREATE UNIQUE INDEX idx_activities_id ON xapi.activities (id);

-- ---------------------------------------------------------------------------
-- Agents (identity merge)
-- ---------------------------------------------------------------------------

-- Tracks all observed IFIs and display names for agents across statements.
-- Used by GET /xapi/agents to return the merged Person object.

CREATE TABLE xapi.agents (
  tenant_id   UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
  ifi         TEXT NOT NULL,           -- canonical IFI string (same as actor_ifi)
  person_data JSONB NOT NULL,          -- { name: [], mbox: [], mbox_sha1sum: [], openid: [], account: [] }
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tenant_id, ifi)
);

-- ON CONFLICT (ifi) requires a unique constraint on ifi alone
CREATE UNIQUE INDEX idx_agents_ifi ON xapi.agents (ifi);

-- ---------------------------------------------------------------------------
-- Tokens (xAPI Basic Auth credentials)
-- ---------------------------------------------------------------------------

-- Each token is scoped to a tenant. The xAPI spec requires HTTP Basic Auth
-- with a key/secret pair; this table stores those credentials.

CREATE TABLE xapi.tokens (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   UUID   NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
  user_sub    TEXT   NOT NULL,
  secret      TEXT   NOT NULL,
  scopes      TEXT[] NOT NULL DEFAULT '{all}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transaction-setup helper for xAPI Basic Auth. Resolves tenant_id and
-- user_sub from the token table and sets GUCs for downstream RLS policies.
--
-- GUCs set:
--   request.tenant.id       – tenant UUID from xapi.tokens
--   request.jwt.claims.sub  – user subject from xapi.tokens
--
-- Raises an exception if the token is not found or the tenant is inactive.

-- ---------------------------------------------------------------------------
-- Attachments (metadata for xAPI multipart/mixed)
-- ---------------------------------------------------------------------------
-- Keyed by SHA-256 hash (hex string). Content-addressable: the same binary
-- uploaded by multiple statements is stored once. Scoped to a tenant.
-- Binary data is stored via AssetStore (filesystem / object storage).

CREATE TABLE xapi.attachments (
  tenant_id    UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
  sha2         TEXT NOT NULL,
  content_type TEXT NOT NULL,

  PRIMARY KEY (tenant_id, sha2)
);

-- ON CONFLICT (sha2) alone — within a tenant the sha2 is unique
CREATE UNIQUE INDEX idx_attachments_sha2 ON xapi.attachments (sha2);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

-- All xAPI data tables are tenant-scoped. RLS ensures queries only see rows
-- belonging to the tenant resolved by private.as_user_oidc() or
-- private.as_user_xapi_basic_auth().

ALTER TABLE xapi.statements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE xapi.documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE xapi.activities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE xapi.agents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE xapi.tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE xapi.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON xapi.statements
  FOR ALL USING (tenant_id = current_setting('request.tenant.id', TRUE)::UUID);

CREATE POLICY tenant_isolation ON xapi.documents
  FOR ALL USING (tenant_id = current_setting('request.tenant.id', TRUE)::UUID);

CREATE POLICY tenant_isolation ON xapi.activities
  FOR ALL USING (tenant_id = current_setting('request.tenant.id', TRUE)::UUID);

CREATE POLICY tenant_isolation ON xapi.agents
  FOR ALL USING (tenant_id = current_setting('request.tenant.id', TRUE)::UUID);

CREATE POLICY tenant_isolation ON xapi.tokens
  FOR ALL USING (tenant_id = current_setting('request.tenant.id', TRUE)::UUID);

CREATE POLICY tenant_isolation ON xapi.attachments
  FOR ALL USING (tenant_id = current_setting('request.tenant.id', TRUE)::UUID);
