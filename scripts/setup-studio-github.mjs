// Temporary, loopback-only account setup. Never included in a deployment artifact.
import { createServer } from 'node:http';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { escape } from './essays.mjs';
import { GitHubPublisher } from '../server/github.mjs';

const directory = '.local/essay-studio', setup = JSON.parse(await readFile(`${directory}/setup.json`, 'utf8'));
const outputs = JSON.parse(await readFile(`${directory}/aws-outputs.json`, 'utf8')).UnrealEssayStudio;
const origin = 'http://127.0.0.1:4313', nonce = randomBytes(32).toString('hex');
const read = async file => { try { return JSON.parse(await readFile(`${directory}/${file}`, 'utf8')); } catch { return null; } };
const save = async (file, value) => { const path = `${directory}/${file}`; await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 }); await chmod(path, 0o600); };
const callback = `https://${setup.projectRef}.supabase.co/auth/v1/callback`;
const oauthUrl = new URL('https://github.com/settings/applications/new');
for (const [key, value] of Object.entries({ name: 'un-real Essay Studio sign-in', url: outputs.StudioURL, callback_url: callback })) oauthUrl.searchParams.set(`oauth_application[${key}]`, value);
const manifest = { name: 'un-real Essay Studio publisher', url: outputs.StudioURL, description: 'Publish only author-reviewed essay releases to un-real-landing.', public: false, redirect_url: `${origin}/github/callback`, setup_url: `${origin}/github/installed?state=${nonce}`, hook_attributes: { url: outputs.StudioURL, active: false }, default_permissions: { contents: 'write', actions: 'read', deployments: 'read' }, default_events: [] };
const github = async (path, options = {}) => {
  const response = await fetch(`https://api.github.com${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options.headers }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}. Retry this step.`); return response.json();
};
const appJwt = async config => new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(String(config.appId)).setIssuedAt(Math.floor(Date.now() / 1000) - 30).setExpirationTime('9m').sign(createPrivateKey(config.privateKey));
const page = async message => {
  const oauth = await read('github-oauth.json'), publisher = await read('github-publisher.json');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Essay Studio</title><style>body{background:#111310;color:#e6e5da;font:18px/1.6 system-ui;margin:40px auto;padding:0 24px;max-width:760px}a{color:#d8aa6a}section{border-top:1px solid #434737;margin:32px 0;padding-top:20px}label{display:block;margin:16px 0}input{display:block;box-sizing:border-box;width:100%;background:#22271f;color:inherit;border:1px solid #68705e;padding:12px;font:inherit}button{padding:12px 20px;background:#d8aa6a;border:0;color:#111310;font:inherit;cursor:pointer}code{overflow-wrap:anywhere}small{color:#b7b9ac}</style><main><h1>Connect your writing room.</h1><p>The hosted Studio is ready for account setup. These credentials are saved privately on this computer.</p>${message ? `<p role="status">${escape(message)}</p>` : ''}<section><h2>1. GitHub sign-in ${oauth ? '— saved' : ''}</h2><p><a href="${escape(oauthUrl.href)}" target="_blank" rel="noopener">Register the sign-in application on GitHub ↗</a>. The name, homepage and callback are prefilled. Leave Device Flow off, register the app, then generate a client secret.</p><p>Callback: <code>${escape(callback)}</code></p><form action="/oauth" method="post"><input type="hidden" name="state" value="${nonce}"><label>Client ID<input name="clientId" required autocomplete="off"></label><label>Client secret<input type="password" name="clientSecret" required autocomplete="off"></label><button>Save sign-in credentials privately</button></form></section><section><h2>2. Reviewed publication ${publisher?.installationId ? '— installed' : ''}</h2><p>Create the publishing app, then install it for <strong>Only select repositories → un-real-landing</strong>. It can commit reviewed essays and read their deployment status.</p>${publisher ? `<p><a href="${escape(publisher.htmlUrl)}/installations/new">Install the publishing app ↗</a></p>` : `<form action="https://github.com/settings/apps/new?state=${nonce}" method="post"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>Create publishing app on GitHub</button></form>`}</section><p><small>This setup server listens only on 127.0.0.1. Close it after setup. Never paste credentials into chat or commit the .local directory.</small></p></main></html>`;
};
const server = createServer(async (request, response) => {
  const finish = (status, body) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' }); response.end(body); };
  try {
    if (request.headers.host !== '127.0.0.1:4313') return finish(403, 'Local setup only.');
    const url = new URL(request.url, origin);
    if (request.method === 'GET' && url.pathname === '/') return finish(200, await page());
    if (request.method === 'POST' && url.pathname === '/oauth') {
      // Some browsers send a null Origin for form navigations after no-referrer.
      // The unguessable form nonce below still protects this loopback-only write.
      if (request.headers.origin && ![origin, 'null'].includes(request.headers.origin)) return finish(403, 'Open http://127.0.0.1:4313 in this browser and submit from that page.');
      let body = ''; for await (const part of request) { body += part; if (body.length > 16000) return finish(413, 'Request too large.'); }
      const form = new URLSearchParams(body);
      if (form.get('state') !== nonce || !/^[a-zA-Z0-9_.-]{8,100}$/.test(form.get('clientId')) || !/^[a-zA-Z0-9_-]{20,200}$/.test(form.get('clientSecret'))) return finish(400, 'Check the ID and secret and retry from the setup screen.');
      await save('github-oauth.json', { clientId: form.get('clientId'), clientSecret: form.get('clientSecret') });
      console.log('GitHub sign-in credentials saved privately.'); return finish(200, await page('Sign-in credentials saved. Continue with the publishing app.'));
    }
    if (request.method === 'GET' && url.pathname === '/github/callback') {
      if (url.searchParams.get('state') !== nonce || !url.searchParams.get('code')) return finish(403, 'Restart registration from the setup screen.');
      const app = await github(`/app-manifests/${encodeURIComponent(url.searchParams.get('code'))}/conversions`, { method: 'POST' });
      if (String(app.owner?.id) !== setup.ownerGithubId) throw new Error('Register this app with the configured GitHub owner account.');
      await save('github-publisher.json', { appId: app.id, privateKey: app.pem, htmlUrl: app.html_url });
      console.log('Publishing app registered; awaiting repository-scoped installation.');
      response.writeHead(303, { Location: `${app.html_url}/installations/new`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/github/installed') {
      if (url.searchParams.get('state') !== nonce || !/^\d+$/.test(url.searchParams.get('installation_id'))) return finish(403, 'Restart installation from the setup screen.');
      const config = await read('github-publisher.json'), installationId = url.searchParams.get('installation_id');
      const installation = await github(`/app/installations/${installationId}`, { headers: { Authorization: `Bearer ${await appJwt(config)}` } });
      if (String(installation.account?.id) !== setup.ownerGithubId || installation.repository_selection !== 'selected') throw new Error('Install for your account with Only select repositories → un-real-landing.');
      const publisher = new GitHubPublisher({ ...config, installationId, repo: 'Switchfools/un-real-landing' }); await publisher.head();
      await save('github-publisher.json', { ...config, installationId }); console.log('Publishing app installation verified for un-real-landing.');
      return finish(200, await page('Publishing access verified. Account setup is saved; the deployment can now be connected.'));
    }
    finish(404, 'Not found.');
  } catch (error) { finish(400, await page(error.message.startsWith('GitHub returned') || /^(Register|Install)/.test(error.message) ? error.message : 'This setup step failed. Restart it from this screen.')); }
});
server.listen(4313, '127.0.0.1', () => console.log(`GitHub account setup: ${origin}`));
