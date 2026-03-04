--! Previous: sha1:44591667b543fcbcd161d367c8ae18119d5f7504
--! Hash: sha1:75f3a5fe256d71e80b153c2ba9af4753514aa473

-- Notify on new statement inserts for SSE streaming.
-- Payload is a compact JSON with enough fields to filter without re-querying.

CREATE OR REPLACE FUNCTION xapi.notify_new_statement() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('xapi_statements_new', json_build_object(
    'tenant_id', NEW.tenant_id,
    'id', NEW.id,
    'verb_id', NEW.verb_id,
    'actor_ifi', NEW.actor_ifi,
    'activity_id', NEW.activity_id,
    'stored', NEW.stored
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_statement_notify
  AFTER INSERT ON xapi.statements
  FOR EACH ROW EXECUTE FUNCTION xapi.notify_new_statement();
