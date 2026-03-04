--! Previous: sha1:75f3a5fe256d71e80b153c2ba9af4753514aa473
--! Hash: sha1:4b9bc002f3b80c491e243be9712d98b58cb893bd

-- Forward targets: one forwarding destination per tenant for LRS-to-LRS sync.
-- No RLS — accessed only by admin UI and internal worker (both use pool directly).

CREATE TABLE tenant.forward_targets (
  tenant_id              UUID PRIMARY KEY REFERENCES tenant.tenants(id) ON DELETE CASCADE,
  url                    TEXT NOT NULL,
  auth_header            TEXT NOT NULL DEFAULT '',
  enabled                BOOLEAN NOT NULL DEFAULT TRUE,
  last_forwarded_stored  TIMESTAMPTZ,
  last_error             TEXT,
  error_count            INT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
