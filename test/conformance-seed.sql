-- Seed data for the ADL LRS Conformance Test Suite.
-- Creates a test tenant and an xAPI Basic Auth token with known credentials.
--
-- Basic Auth credentials:
--   user:     00000000-0000-4000-8000-000000000099
--   password: conformance-secret

INSERT INTO tenant.tenants (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000000001', 'Conformance Test Tenant', 'conformance-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO xapi.tokens (id, tenant_id, user_sub, secret)
VALUES ('00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000001', 'conformance-runner', 'conformance-secret')
ON CONFLICT (id) DO NOTHING;
