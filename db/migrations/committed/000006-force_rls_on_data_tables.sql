--! Previous: sha1:a872c440af3f537f8b1da73aa7181fa27f8b44e7
--! Hash: sha1:562162ec1c5c501ac3d1abecd01a2f0962657f64

-- Force RLS on data tables so the table owner (lrs) is also subject
-- to row-level security policies. Without this, the lrs role bypasses
-- RLS entirely because it owns the tables.
--
-- xapi.tokens is intentionally excluded — token lookups happen before
-- the tenant GUC is set (auth middleware, SECURITY DEFINER function).

ALTER TABLE xapi.statements  FORCE ROW LEVEL SECURITY;
ALTER TABLE xapi.documents   FORCE ROW LEVEL SECURITY;
ALTER TABLE xapi.activities  FORCE ROW LEVEL SECURITY;
ALTER TABLE xapi.agents      FORCE ROW LEVEL SECURITY;
ALTER TABLE xapi.attachments FORCE ROW LEVEL SECURITY;
