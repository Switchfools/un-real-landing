CREATE SCHEMA IF NOT EXISTS essay_studio;
CREATE TABLE IF NOT EXISTS essay_studio.records (
  owner text NOT NULL,
  kind text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL CONSTRAINT record_is_object CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, kind, id)
);
ALTER TABLE essay_studio.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE essay_studio.records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owned_records ON essay_studio.records;
CREATE POLICY owned_records ON essay_studio.records
  USING (owner = current_setting('essay_studio.owner', true))
  WITH CHECK (owner = current_setting('essay_studio.owner', true));
CREATE OR REPLACE FUNCTION essay_studio.preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind IN ('revision', 'proposal-version', 'approval', 'release-preview', 'release-snapshot', 'receipt', 'import-file', 'legacy-release', 'migration') THEN
    RAISE EXCEPTION 'Historical records are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS immutable_history ON essay_studio.records;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON essay_studio.records
  FOR EACH ROW EXECUTE FUNCTION essay_studio.preserve_history();
REVOKE ALL ON SCHEMA essay_studio FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA essay_studio FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA essay_studio FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA essay_studio FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'essay_studio_api') THEN
    GRANT USAGE ON SCHEMA essay_studio TO essay_studio_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON essay_studio.records TO essay_studio_api;
  END IF;
END $$;
