"""Provision the separate Supabase project and prepare private configuration.

Uses an authenticated Supabase CLI; never prints credentials. Run from repo root.
SUPABASE_CLI may point to an already installed binary.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
from urllib.parse import quote, urlsplit

LOCAL = Path('.local/essay-studio')
STATE = LOCAL / 'setup.json'
RUNTIME = LOCAL / 'runtime.json'
LOCAL.mkdir(parents=True, exist_ok=True)
CLI = os.environ.get('SUPABASE_CLI', 'supabase')


def private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        stream.write(data)
    path.chmod(0o600)


def cli(*args):
    result = subprocess.run([CLI, *args, '--output', 'json', '--yes'], capture_output=True, text=True, timeout=300)
    if result.returncode:
        # CLI errors can echo SQL, passwords or connection strings. Keep them private.
        private(LOCAL / 'last-cli-error.log', result.stderr)
        raise RuntimeError('Supabase command failed. Its diagnostic is in .local/essay-studio/last-cli-error.log (may contain secrets).')
    try:
        return json.loads(result.stdout or '{}')
    except json.JSONDecodeError:
        return {}


def state():
    if not STATE.exists():
        raise RuntimeError('Run create first, or restore the private setup.json backup.')
    return json.loads(STATE.read_text())


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def query(sql):
    path = LOCAL / 'query.sql'
    private(path, sql)
    try:
        return cli('db', 'query', '--linked', '--project-ref', state()['projectRef'], '--file', str(path)).get('rows', [])
    finally:
        path.unlink(missing_ok=True)


def create(args):
    values = state() if STATE.exists() else {'databasePassword': secrets.token_urlsafe(48), 'orgId': args.org, 'name': 'unreal-essay-studio', 'ownerGithubId': args.owner}
    if values['orgId'] != args.org or values['ownerGithubId'] != args.owner:
        raise RuntimeError('Existing setup belongs to a different owner or organization.')
    private(STATE, json.dumps(values, indent=2))
    projects = cli('projects', 'list')
    existing = [p for p in projects if p.get('name') == values['name'] and p.get('organization_id') == args.org]
    if values.get('projectRef'):
        print('Using separate Studio project:', values['projectRef']); return
    if existing:
        raise RuntimeError('A Studio project already exists without its saved projectRef. Recover setup.json; do not reset its database password.')
    project = cli('projects', 'create', values['name'], '--org-id', args.org, '--db-password', values['databasePassword'], '--region', 'eu-central-1')
    values['projectRef'] = project['id']
    private(STATE, json.dumps(values, indent=2))
    print('Created separate Studio project:', values['projectRef'])


def configure(args):
    values = state()
    origin = args.origin.rstrip('/')
    url = urlsplit(origin)
    if url.scheme != 'https' or not url.hostname or url.path or url.query or url.fragment:
        raise RuntimeError('Supply the CloudFront HTTPS origin without a path.')
    existing = query("select rolcanlogin from pg_roles where rolname='essay_studio_api'")
    if existing and not RUNTIME.exists():
        raise RuntimeError('Runtime role exists: restore runtime.json from Secrets Manager before reconfiguration.')
    runtime = json.loads(RUNTIME.read_text()) if RUNTIME.exists() else {}
    if not runtime:
        keys = cli('projects', 'api-keys', '--project-ref', values['projectRef'])
        public = next(k['api_key'] for k in keys if k.get('name') == 'anon' or k.get('type') == 'publishable')
        secret = next(k['api_key'] for k in keys if k.get('name') == 'service_role' or k.get('type') == 'secret')
        pooler = args.pooler
        if not pooler:
            workdir = LOCAL / 'auth'
            config_path = workdir / 'supabase/config.toml'
            if not config_path.exists():
                private(config_path, 'project_id = "unreal-essay-studio"\n')
            cli('link', '--project-ref', values['projectRef'], '--password', values['databasePassword'], '--workdir', str(workdir))
            pooler = urlsplit((workdir / 'supabase/.temp/pooler-url').read_text().strip()).hostname
        if not pooler or not pooler.endswith('.pooler.supabase.com') or '/' in pooler:
            raise RuntimeError('Supply the session/transaction pooler hostname from this project’s Connect dialog.')
        password = secrets.token_urlsafe(48)
        runtime = {'databaseUrl': f"postgresql://essay_studio_api.{values['projectRef']}:{quote(password)}@{pooler}:6543/postgres", 'supabaseUrl': f"https://{values['projectRef']}.supabase.co", 'supabasePublishableKey': public, 'supabaseSecretKey': secret}
    runtime.update(origin=origin, ownerGithubId=values['ownerGithubId'])
    private(RUNTIME, json.dumps(runtime, indent=2))
    password = urlsplit(runtime['databaseUrl']).password
    query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='essay_studio_api') THEN CREATE ROLE essay_studio_api NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF; END $$;\n" + Path('server/schema.sql').read_text() + '\n' + Path('server/auth-schema.sql').read_text() + '\n'
          + 'ALTER ROLE essay_studio_api LOGIN PASSWORD ' + literal(password) + "; ALTER ROLE essay_studio_api SET statement_timeout='20s';\n"
          + 'INSERT INTO essay_studio_auth.configuration(singleton,github_id,origin) VALUES(true,' + literal(values['ownerGithubId']) + ',' + literal(origin) + ') ON CONFLICT(singleton) DO UPDATE SET github_id=excluded.github_id, origin=excluded.origin;')
    config = f'''project_id = "unreal-essay-studio"
[auth]
site_url = {json.dumps(origin)}
additional_redirect_urls = [{json.dumps(origin + '/auth/callback')}]
enable_signup = true
enable_anonymous_sign_ins = false
[auth.email]
enable_signup = false
[auth.external.github]
enabled = true
client_id = "env(STUDIO_GITHUB_CLIENT_ID)"
secret = "env(STUDIO_GITHUB_CLIENT_SECRET)"
redirect_uri = ""
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/essay_studio_auth/owner_signup"
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/essay_studio_auth/mcp_access_token"
[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
'''
    private(LOCAL / 'auth/supabase/config.toml', config)
    print('Database schema, dedicated runtime role, owner allowlist and OAuth hooks configured.')
    print('Private runtime configuration: .local/essay-studio/runtime.json')
    print('Auth config prepared; configure the GitHub OAuth application and push it as documented.')
    print('GitHub OAuth callback:', runtime['supabaseUrl'] + '/auth/v1/callback')


def apply_auth(args):
    oauth = json.loads((LOCAL / 'github-oauth.json').read_text())
    os.environ['STUDIO_GITHUB_CLIENT_ID'] = oauth['clientId']
    os.environ['STUDIO_GITHUB_CLIENT_SECRET'] = oauth['clientSecret']
    cli('config', 'push', '--project-ref', state()['projectRef'], '--workdir', str(LOCAL / 'auth'))
    print('Owner-only GitHub sign-in and MCP OAuth configuration applied.')


parser = argparse.ArgumentParser()
commands = parser.add_subparsers(dest='command', required=True)
c = commands.add_parser('create'); c.add_argument('--org', required=True); c.add_argument('--owner', required=True)
c = commands.add_parser('configure'); c.add_argument('--origin', required=True); c.add_argument('--pooler')
c = commands.add_parser('apply-auth')
args = parser.parse_args()
try:
    {'create': create, 'configure': configure, 'apply-auth': apply_auth}[args.command](args)
except Exception as error:
    raise SystemExit(str(error)) from None
