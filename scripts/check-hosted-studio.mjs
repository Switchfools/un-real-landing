import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const outputs = JSON.parse(await readFile('.local/essay-studio/aws-outputs.json', 'utf8')).UnrealEssayStudio;
const origin = outputs.StudioURL;
const configResponse = await fetch(`${origin}/api/config`), config = await configResponse.json();
assert.equal(configResponse.status, 200); assert.equal(config.hosted, true); assert.equal(config.local, false);
assert.equal(config.origin, origin);
assert.match(configResponse.headers.get('x-robots-tag') || '', /noindex/);
if (outputs.CloudFrontURL) {
  const redirect = await fetch(`${outputs.CloudFrontURL}/?proposal=test&version=2`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), `${origin}/?proposal=test&version=2`);
}
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
  const workerResponse = await fetch(`${origin}/scripts/visualization-worker.js`);
  assert.equal(workerResponse.status, 200);
  assert.match(workerResponse.headers.get('content-security-policy') || '', /script-src 'wasm-unsafe-eval'; connect-src 'none'/);
  const visualization = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/scripts/visualization-worker.js', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Visualization worker did not respond.')); }, 10000);
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Visualization worker failed.')); };
    worker.onmessage = ({ data }) => {
      if (data.ready) worker.postMessage({ id: 1, input: { width: 640, height: 320, values: {}, pointer: { x: 0, y: 0, down: false }, time: 0, reducedMotion: true }, code: 'function render() { const root = ({}).constructor.constructor("return globalThis")(); return {commands:[],caption:["fetch","document","localStorage","postMessage","process"].every(key => typeof root[key] === "undefined") ? "isolated" : "unexpected access"}; }' });
      else { clearTimeout(timer); worker.terminate(); resolve(data); }
    };
  }));
  assert.equal(visualization.frame?.caption, 'isolated');
  await mkdir('test-results/hosted-smoke', { recursive: true }); await page.screenshot({ path: 'test-results/hosted-smoke/sign-in.png' });
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  console.log('Hosted sign-in, OAuth, private-schema/API/MCP protection, and isolated visualization worker checks passed.');
} finally { await browser.close(); }
