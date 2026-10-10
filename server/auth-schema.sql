CREATE SCHEMA IF NOT EXISTS essay_studio_auth;
REVOKE ALL ON SCHEMA essay_studio_auth FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS essay_studio_auth.configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  github_id text NOT NULL, origin text NOT NULL
);
REVOKE ALL ON essay_studio_auth.configuration FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION essay_studio_auth.owner_signup(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE allowed text;
BEGIN
  SELECT github_id INTO allowed FROM essay_studio_auth.configuration WHERE singleton;
  IF event->'user'->'app_metadata'->>'provider' = 'github'
     AND coalesce(event->'user'->'user_metadata'->>'provider_id', event->'user'->'user_metadata'->>'sub') = allowed THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN '{"error":{"http_code":403,"message":"This writing workspace is private."}}'::jsonb;
END $$;
CREATE OR REPLACE FUNCTION essay_studio_auth.mcp_access_token(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims jsonb := event->'claims'; client text; origin text;
BEGIN
  client := coalesce(claims->>'client_id', event->>'client_id');
  IF client IS NOT NULL THEN
    SELECT c.origin INTO origin FROM essay_studio_auth.configuration c WHERE singleton;
    claims := jsonb_set(claims, '{aud}', to_jsonb(origin || '/mcp'));
    claims := jsonb_set(claims, '{client_id}', to_jsonb(client));
  END IF;
  RETURN jsonb_build_object('claims', claims);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA essay_studio_auth FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA essay_studio_auth TO supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA essay_studio_auth TO supabase_auth_admin;
