import { serve } from '@hono/node-server';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDatabase } from '../server/database.mjs';
import { Workspace } from '../server/workspace.mjs';
import { MediaService } from '../server/media.mjs';
import { Jobs } from '../server/jobs.mjs';
import { Narration } from '../server/narration.mjs';
import { Releases } from '../server/releases.mjs';
import { createApp } from '../server/app.mjs';
import { requireValue } from '../server/errors.mjs';

export async function createHostedPreview({ root = resolve('.local/hosted-preview'), port = 4312, fixture = false } = {}) {
  await mkdir(root, { recursive: true });
  const pg = new PGlite(join(root, 'database')); await pg.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const db = pgliteDatabase(pg), config = { local: true, origin: `http://127.0.0.1:${port}`, supabaseUrl: '', supabasePublishableKey: '' };
  const identity = { owner: 'local-author', userId: 'local', clientId: null, permissions: ['read', 'propose'] }, workspace = new Workspace(db, config);
  const tickets = new Map(), urls = new Map();
  const storage = {
    uploadTicket: async asset => { const token = randomUUID(); tickets.set(token, asset); return { url: `${config.origin}/local-upload/${token}`, fields: {} }; },
    head: async asset => { const data = JSON.parse(await readFile(join(root, 'media', `${asset.filename}.json`), 'utf8')); return data; },
    download: async asset => { const token = randomUUID(); urls.set(token, asset); return `${config.origin}/local-media/${token}`; },
    read: asset => readFile(join(root, 'media', asset.filename)),
    put: async (asset, bytes) => { await mkdir(join(root, 'media'), { recursive: true }); await writeFile(join(root, 'media', asset.filename), bytes); await writeFile(join(root, 'media', `${asset.filename}.json`), JSON.stringify(asset)); return asset; },
  };
  const media = new MediaService(workspace, storage), jobs = new Jobs(workspace);
  let audio = {};
  const secrets = { getAudio: async () => audio, setAudio: async value => { audio = { ...audio, ...value }; return { connected: Boolean(audio.apiKey), voiceId: audio.voiceId }; } };
  const narration = new Narration(workspace, media, jobs, secrets);
  const noPublishing = async () => { throw Object.assign(new Error('This local preview does not publish. Use the hosted Studio to release an essay.'), { status: 503 }); };
  const releases = new Releases(workspace, { head: noPublishing }, media, jobs);
  const authenticate = async (request, mcp) => {
    const token = request.headers.get('authorization');
    requireValue(mcp ? token === 'Bearer local-ai' : token === 'Bearer local-author', 'Invalid local preview identity.', 403);
    return { ...identity, clientId: mcp ? 'local-chatgpt' : null };
  };
  const app = createApp({ config, workspace, authenticate, media, jobs, narration, releases, secrets });
  app.post('/local-upload/:token', async c => {
    const asset = tickets.get(c.req.param('token')); requireValue(asset, 'Upload ticket expired.', 403);
    const form = await c.req.formData(), file = form.get('file'); requireValue(file instanceof File, 'Choose a file.');
    const bytes = Buffer.from(await file.arrayBuffer()); const { createHash } = await import('node:crypto');
    requireValue(bytes.length === asset.size && createHash('sha256').update(bytes).digest('base64') === asset.checksum, 'File integrity check failed.');
    await storage.put(asset, bytes); tickets.delete(c.req.param('token')); return c.body(null, 204);
  });
  app.get('/local-media/:token', async c => { const asset = urls.get(c.req.param('token')); requireValue(asset, 'Media access expired.', 403); c.header('Content-Type', asset.type); return c.body(await storage.read(asset)); });
  app.get('*', async c => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/mcp')) return c.notFound();
    const relative = ['/', '/oauth/consent', '/auth/callback'].includes(path) ? 'index.html' : path.slice(1);
    const target = resolve('.build/studio', relative); requireValue(target.startsWith(resolve('.build/studio') + '/'), 'Not found.', 404);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    try { c.header('Content-Type', types[extname(target)] || 'application/octet-stream'); return c.body(await readFile(target)); } catch { return c.notFound(); }
  });
  if (fixture) {
    const source = await readFile('tests/fixtures/essays/from-belief-to-action.md', 'utf8');
    await workspace.create(identity, 'from-belief-to-action', source);
  }
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
  const worker = setInterval(async () => {
    try { for (const job of await workspace.tx(identity, tx => tx.list('job'))) if (job.state === 'queued') await jobs.run(identity, job.id, item => item.kind === 'narration' ? narration.part(identity, item) : noPublishing()); } catch { /* Status remains available in the local workspace. */ }
  }, 1000);
  const close = async () => { clearInterval(worker); await new Promise(resolve => server.close(resolve)); await db.close(); };
  return { close, workspace, identity };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const preview = await createHostedPreview(); console.log('Hosted workflow preview: http://127.0.0.1:4312/ (local data; no cloud publication).');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await preview.close(); process.exit(); });
}
