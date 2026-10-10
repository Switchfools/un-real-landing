import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { parseEssay, serializeEssay, validateEssay, renderArticle, narrationHash, narrationText } from '../scripts/essays.mjs';
import { requireValue, requireHuman, now } from './errors.mjs';
import { handleMcp } from './mcp.mjs';

export function createApp({ config, workspace, authenticate, media, jobs, narration, releases, secrets }) {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 3_000_000, onError: c => c.json({ error: 'Request is too large. Upload media directly using an upload ticket.' }, 413) }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    const origin = c.req.header('origin');
    requireValue(!origin || origin === config.origin, 'Cross-origin requests are not allowed.', 403);
    if (config.local) requireValue(['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname), 'Local connections only.', 403);
    await next();
  });
  app.get('/api/health', c => c.json({ ok: true }));
  app.get('/api/config', c => c.json({ hosted: true, local: Boolean(config.local), supabaseUrl: config.supabaseUrl, supabasePublishableKey: config.supabasePublishableKey, origin: config.origin }));
  app.get('/.well-known/oauth-protected-resource', c => c.json({ resource: `${config.origin}/mcp`, authorization_servers: [`${config.supabaseUrl}/auth/v1`], scopes_supported: ['openid', 'email', 'profile'], resource_name: 'un-real Essay Studio' }));
  app.get('/.well-known/oauth-protected-resource/mcp', c => c.redirect(`${config.origin}/.well-known/oauth-protected-resource`));
  app.all('/mcp', async c => {
    try { const identity = await authenticate(c.req.raw, true); return handleMcp(c.req.raw, workspace, identity); }
    catch (error) {
      if (error.status === 401 || error.status === 403) c.header('WWW-Authenticate', `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource", error="${error.status === 401 ? 'invalid_token' : 'insufficient_scope'}"`);
      throw error;
    }
  });
  app.use('/api/*', async (c, next) => {
    const identity = await authenticate(c.req.raw, false); requireHuman(identity); c.set('identity', identity);
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      requireValue(c.req.header('origin') === config.origin, 'A matching Studio Origin is required.', 403);
      requireValue(c.req.header('content-type')?.startsWith('application/json'), 'Expected application/json.', 415);
    }
    await next();
  });
  const identity = c => c.get('identity');
  app.get('/api/me', c => c.json({ owner: identity(c).owner }));
  app.get('/api/essays', async c => c.json(await workspace.list(identity(c))));
  app.post('/api/essays', async c => {
    const input = await c.req.json(); let doc;
    if (input.source) { try { doc = parseEssay(input.source); } catch { doc = { metadata: {}, body: input.source }; } }
    else doc = { metadata: {}, body: '## Start with a question\n\nWhat do you believe, and why does it matter?' };
    doc.metadata = { title: input.title || 'Untitled essay', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), author: 'Nicolás Vergara', summary: '', description: '', action: '', ...doc.metadata, draft: true, status: 'Draft' };
    return c.json(await workspace.create(identity(c), input.slug, serializeEssay(doc), input.source || serializeEssay(doc)), 201);
  });
  app.get('/api/essays/:slug', async c => c.json(await workspace.get(identity(c), c.req.param('slug'))));
  app.put('/api/essays/:slug', async c => c.json(await workspace.save(identity(c), c.req.param('slug'), await c.req.json())));
  app.post('/api/render', async c => { const doc = await c.req.json(); validateEssay(doc); return c.json({ html: await media.urls(identity(c), renderArticle(doc, { draft: true })), source: serializeEssay(doc), narrationHash: narrationHash(doc), narrationCharacters: narrationText(doc).length }); });
  app.post('/api/parse', async c => { const { source } = await c.req.json(); const doc = /^---\r?\n/.test(source) ? parseEssay(source) : { metadata: {}, body: source }; validateEssay(doc); doc.metadata.draft = true; return c.json(doc); });
  app.get('/api/essays/:slug/history', async c => c.json(await workspace.history(identity(c), c.req.param('slug'))));
  app.get('/api/essays/:slug/history/:name', async c => c.json(await workspace.revision(identity(c), c.req.param('slug'), c.req.param('name'))));
  app.get('/api/proposals', async c => c.json(await workspace.proposals(identity(c), c.req.query('slug'))));
  app.get('/api/proposals/:id', async c => { const result = await workspace.proposal(identity(c), c.req.param('id'), c.req.query('version') ? Number(c.req.query('version')) : undefined); result.html = await media.urls(identity(c), result.html); return c.json(result); });
  app.post('/api/proposals/:id/approve', async c => c.json(await workspace.decide(identity(c), c.req.param('id'), await c.req.json(), true)));
  app.post('/api/proposals/:id/reject', async c => c.json(await workspace.decide(identity(c), c.req.param('id'), await c.req.json(), false)));
  app.post('/api/essays/:slug/release-preview', async c => { const result = await releases.prepare(identity(c), c.req.param('slug'), await c.req.json()); result.html = await media.urls(identity(c), result.html); return c.json(result); });
  app.post('/api/releases/:id/confirm', async c => { const result = await releases.confirm(identity(c), c.req.param('id'), await c.req.json()); await jobs.dispatch(identity(c)); return c.json(result, 202); });
  app.get('/api/releases', async c => c.json(await releases.list(identity(c))));
  app.get('/api/releases/:id', async c => c.json(await releases.get(identity(c), c.req.param('id'))));
  app.post('/api/jobs/:id/retry', async c => c.json(await jobs.retry(identity(c), c.req.param('id')), 202));
  app.post('/api/essays/:slug/uploads', async c => c.json(await media.ticket(identity(c), c.req.param('slug'), await c.req.json()), 201));
  app.post('/api/media/:slug/:filename/complete', async c => c.json(await media.complete(identity(c), `${c.req.param('slug')}/${c.req.param('filename')}`)));
  app.get('/api/media/:slug/:filename/url', async c => { const asset = await workspace.tx(identity(c), tx => tx.get('asset', `${c.req.param('slug')}/${c.req.param('filename')}`)); requireValue(asset.state === 'ready', 'Upload is incomplete.'); return c.json({ url: await media.storage.download(asset) }); });
  app.get('/api/audio-settings', async c => { const settings = await secrets.getAudio(); return c.json({ connected: Boolean(settings.apiKey), voiceId: settings.voiceId || 'nPczCjzI2devNBz1zQrb', narrator: settings.voiceId && settings.voiceId !== 'nPczCjzI2devNBz1zQrb' ? 'ElevenLabs narrator' : 'Brian · ElevenLabs' }); });
  app.post('/api/audio-settings', async c => c.json(await secrets.setAudio(await c.req.json())));
  app.get('/api/voices', async c => {
    const { apiKey } = await secrets.getAudio(); requireValue(apiKey, 'Connect ElevenLabs first.');
    const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(20000) });
    requireValue(response.ok, `ElevenLabs returned ${response.status}. Check the key’s voices_read permission.`, 502);
    return c.json((await response.json()).voices.map(voice => ({ id: voice.voice_id, name: voice.name, description: Object.values(voice.labels || {}).join(' · ') })));
  });
  const playable = async (actor, audio) => {
    if (!audio?.tracks?.length) return null;
    const id = audio.tracks[0].src.replace('../../assets/essays/', '');
    const asset = await workspace.tx(actor, tx => tx.get('asset', id));
    return { ...audio, playbackUrl: await media.storage.download(asset) };
  };
  app.get('/api/essays/:slug/narration-preview', async c => c.json(await playable(identity(c), await workspace.tx(identity(c), tx => tx.get('settings', `narration-preview:${c.req.param('slug')}`, false)))));
  app.get('/api/essays/:slug/narration', async c => { const result = await narration.status(identity(c), c.req.param('slug')); if (result.audio && result.sample) result.audio = await playable(identity(c), result.audio); return c.json(result); });
  app.post('/api/essays/:slug/narration', async c => { const result = await narration.start(identity(c), c.req.param('slug'), await c.req.json()); await jobs.dispatch(identity(c)); return c.json(result, 202); });
  app.post('/api/essays/:slug/narration/ack', async c => c.json(await narration.ack(identity(c), c.req.param('slug'))));
  app.get('/api/connections', async c => c.json(await workspace.tx(identity(c), tx => tx.list('grant'))));
  app.post('/api/connections/authorize', async c => {
    const input = await c.req.json(); requireValue(typeof input.authorizationId === 'string' && input.authorizationId.length < 300, 'Invalid authorization request.');
    requireValue(Array.isArray(input.permissions) && input.permissions.includes('read') && input.permissions.every(value => ['read', 'propose'].includes(value)), 'Choose read access and optionally proposals.');
    const response = await fetch(`${config.supabaseUrl}/auth/v1/oauth/authorizations/${encodeURIComponent(input.authorizationId)}`, { headers: { Authorization: c.req.header('authorization'), apikey: config.supabasePublishableKey }, signal: AbortSignal.timeout(15000) });
    const details = await response.json();
    requireValue(response.ok && details.client?.id && details.user?.id === identity(c).userId, 'The OAuth authorization request expired or is invalid.');
    const clientId = details.client.id;
    await workspace.tx(identity(c), tx => tx.put('grant', clientId, { clientId, userId: identity(c).userId, permissions: input.permissions, revoked: false, createdAt: now(), name: details.client.name || 'ChatGPT' }));
    return c.json({ ok: true });
  });
  app.post('/api/connections/:id/revoke', async c => {
    await workspace.tx(identity(c), async tx => { const grant = await tx.get('grant', c.req.param('id')); await tx.put('grant', c.req.param('id'), { ...grant, revoked: true, revokedAt: now() }); }); return c.json({ ok: true });
  });
  app.onError((error, c) => {
    const status = error.status || (error.name === 'ZodError' || error instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error(JSON.stringify({ event: 'request_failed', path: new URL(c.req.url).pathname, type: error.name }));
    return c.json({ error: error.status ? error.message : status === 400 ? 'Invalid request. Check the required fields.' : 'Unable to complete the request. Please retry or export your edits.' }, status);
  });
  return app;
}
