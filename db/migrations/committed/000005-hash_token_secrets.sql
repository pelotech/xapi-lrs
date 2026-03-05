--! Previous: sha1:4b9bc002f3b80c491e243be9712d98b58cb893bd
--! Hash: sha1:a872c440af3f537f8b1da73aa7181fa27f8b44e7

-- Hash token secrets with bcrypt via pgcrypto.
-- After this migration, plaintext secrets are no longer stored.

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;
CREATE SCHEMA IF NOT EXISTS private;

-- Rename column for clarity
ALTER TABLE xapi.tokens RENAME COLUMN secret TO secret_hash;

-- Hash any existing plaintext secrets in-place
UPDATE xapi.tokens SET secret_hash = crypt(secret_hash, gen_salt('bf'));

-- Recreate auth function to use bcrypt comparison instead of plaintext equality
CREATE OR REPLACE FUNCTION private.as_user_xapi_basic_auth(
  p_token_id UUID,
  p_secret   TEXT
) RETURNS VOID AS $$
DECLARE
  v_tenant_id UUID;
  v_user_sub  TEXT;
BEGIN
  SELECT tenant_id, user_sub INTO v_tenant_id, v_user_sub
    FROM xapi.tokens
   WHERE id = p_token_id
     AND secret_hash = crypt(p_secret, secret_hash);

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_authorization_specification'
      USING ERRCODE = '28000';
  END IF;

  PERFORM set_config('request.tenant.id', v_tenant_id::TEXT, TRUE);
  PERFORM set_config('request.jwt.claims.sub', v_user_sub, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
