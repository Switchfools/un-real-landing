import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const outputs = JSON.parse(await readFile('.local/essay-studio/aws-outputs.json', 'utf8')).UnrealEssayStudio;
const origin = outputs.StudioURL;
const configResponse = await fetch(`${origin}/api/config`), config = await configResponse.json();
assert.equal(configResponse.status, 200); assert.equal(config.hosted, true); assert.equal(config.local, false);
for (const path of ['/api/essays', '/api/connections', '/mcp']) {
  const response = await fetch(origin + path); assert.equal(response.status, 401, path);
  if (path === '/mcp') assert.match(response.headers.get('www-authenticate'), /resource_metadata=/);
}
const metadata = await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json();
assert.equal(metadata.resource, origin + '/mcp');
const discovery = await fetch(`${config.supabaseUrl}/auth/v1/.well-known/oauth-authorization-server`);
assert.equal(discovery.status, 200, 'Supabase OAuth discovery');
const dataAccess = await fetch(`${config.supabaseUrl}/rest/v1/records?select=id`, { headers: { apikey: config.supabasePublishableKey, 'Accept-Profile': 'essay_studio' } });
assert.ok([401, 403, 406].includes(dataAccess.status), 'Private schema must not be exposed to the public key');
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(new URL(response.url()).pathname); });
  await page.goto(origin); await page.locator('.studio-login').waitFor();
  await page.getByRole('button', { name: 'Sign in with GitHub' }).focus();
  await mkdir('test-results/hosted-smoke', { recursive: true }); await page.screenshot({ path: 'test-results/hosted-smoke/sign-in.png' });
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  console.log('Hosted sign-in assets, OAuth discovery, private-schema denial, and unauthenticated API/MCP checks passed.');
} finally { await browser.close(); }
