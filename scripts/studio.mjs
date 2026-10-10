import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StudioStore, fail } from './studio-store.mjs';
import { parseEssay, serializeEssay, renderArticle, validateEssay, narrationHash, narrationText } from './essays.mjs';
import { generateNarration } from './narration.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };

async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw fail('Expected application/json.', 415);
  const buffers = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 85_000_000) throw fail('Upload is too large (60 MB maximum).', 413); buffers.push(chunk); }
  try { return JSON.parse(Buffer.concat(buffers).toString()); } catch { throw fail('Invalid JSON.'); }
}

export async function createStudioServer({ contentRoot = process.env.STUDIO_CONTENT_ROOT || join(project, 'content') } = {}) {
  const store = new StudioStore(contentRoot); await store.init();
  let apiKey = process.env.ELEVENLABS_API_KEY || '';
  let defaultVoice = process.env.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb';
  const jobs = new Map();
  const server = createServer(async (request, response) => {
    const send = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const host = request.headers.host;
      if (!/^127\.0\.0\.1:\d+$/.test(host || '') && !/^localhost:\d+$/.test(host || '')) throw fail('Local connections only.', 403);
      if (request.headers.origin && request.headers.origin !== `http://${host}`) throw fail('Cross-origin requests are not allowed.', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site requests are not allowed.', 403);
      const url = new URL(request.url, `http://${host}`);
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith('/api/')) {
        const method = request.method;
        if (path === '/api/config' && method === 'GET') return send({ hosted: false });
        if (!['GET', 'POST', 'PUT'].includes(method)) throw fail('Method not allowed.', 405);
        if (method !== 'GET' && request.headers.origin !== `http://${host}`) throw fail('A matching local Origin is required.', 403);
        if (path === '/api/essays' && method === 'GET') return send(await store.list());
        if (path === '/api/essays' && method === 'POST') {
          const input = await jsonBody(request);
          let doc;
          if (input.source) {
            try { doc = parseEssay(input.source); } catch { doc = { metadata: {}, body: input.source }; }
            doc.metadata.author ||= doc.metadata.authors?.join(' & ') || 'Nicolás Vergara';
            doc.metadata.description ||= doc.metadata.subtitle || '';
          } else doc = { metadata: {}, body: '## Start with a question\n\nWhat do you believe, and why does it matter?' };
          doc.metadata = { title: input.title || 'Untitled essay', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), author: 'Nicolás Vergara', summary: '', description: '', action: '', ...doc.metadata, draft: true, status: 'Draft' };
          return send(await store.create(input.slug, serializeEssay(doc), input.source || serializeEssay(doc)), 201);
        }
        if (path === '/api/render' && method === 'POST') {
          const doc = await jsonBody(request); validateEssay(doc);
          return send({ html: renderArticle(doc, { draft: true }), source: serializeEssay(doc), narrationHash: narrationHash(doc), narrationCharacters: narrationText(doc).length });
        }
        if (path === '/api/parse' && method === 'POST') {
          const { source } = await jsonBody(request);
          let doc;
          if (source.startsWith('---\n') || source.startsWith('---\r\n')) doc = parseEssay(source);
          else doc = { metadata: {}, body: source };
          validateEssay(doc); doc.metadata.draft = true;
          return send(doc);
        }
        if (path === '/api/audio-settings' && method === 'GET') return send({ connected: Boolean(apiKey), voiceId: defaultVoice, narrator: defaultVoice === 'nPczCjzI2devNBz1zQrb' ? 'Brian · ElevenLabs' : 'ElevenLabs narrator' });
        if (path === '/api/audio-settings' && method === 'POST') {
          const input = await jsonBody(request);
          if (typeof input.apiKey === 'string' && input.apiKey.trim()) apiKey = input.apiKey.trim();
          if (typeof input.voiceId === 'string') defaultVoice = input.voiceId.trim();
          return send({ connected: Boolean(apiKey), voiceId: defaultVoice });
        }
        if (path === '/api/voices' && method === 'GET') {
          if (!apiKey) throw fail('Connect ElevenLabs first.');
          const result = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(20000) });
          if (!result.ok) {
            const error = await result.json().catch(() => ({}));
            if (error.detail?.status === 'missing_permissions') throw fail('Your ElevenLabs key needs voices_read permission to browse voices. You can still paste a voice ID and generate speech.', 403);
            throw fail(`ElevenLabs returned ${result.status}. Check your API key and voice permissions.`, 502);
          }
          const data = await result.json();
          return send((data.voices || []).map(voice => ({ id: voice.voice_id, name: voice.name, description: Object.values(voice.labels || {}).join(' · ') })));
        }
        const match = path.match(/^\/api\/essays\/([a-z0-9-]+)(?:\/(.*))?$/);
        if (!match) throw fail('Not found.', 404);
        const [, slug, action] = match;
        if (!action && method === 'GET') return send(await store.get(slug));
        if (!action && method === 'PUT') return send(await store.save(slug, await jsonBody(request)));
        if (action === 'history' && method === 'GET') return send(await store.history(slug));
        if (action?.startsWith('history/') && method === 'GET') return send({ source: await store.revision(slug, action.slice(8)) });
        if (action === 'publish' && method === 'POST') return send(await store.publish(slug, await jsonBody(request)));
        if (action === 'narration-preview' && method === 'GET') {
          try { return send(parseEssay(await readFile(join(store.dir('workbench', slug), 'narration-preview.md'), 'utf8')).metadata); }
          catch (error) { if (error.code === 'ENOENT') return send(null); throw error; }
        }
        if (action === 'narration' && method === 'GET') return send(jobs.get(slug) || { state: 'idle' });
        if (action === 'narration/ack' && method === 'POST') {
          await jsonBody(request);
          if (jobs.get(slug)?.state === 'complete') jobs.set(slug, { state: 'idle' });
          return send({ ok: true });
        }
        if (action === 'narration' && method === 'POST') {
          const input = await jsonBody(request), document = await store.get(slug);
          store.checkRevision(document, input);
          if (!apiKey || !(input.voiceId || defaultVoice)) throw fail('Connect ElevenLabs and choose a voice first.');
          if (jobs.get(slug)?.state === 'running') throw fail('Narration is already being generated for this essay.', 409);
          if (!input.sample && (!document.metadata.summary?.trim() || !document.body.trim())) throw fail('Write the summary and essay before generating narration.');
          jobs.set(slug, { state: 'running', completed: 0, total: 0, sample: Boolean(input.sample) });
          // Generating is an explicit UI action; keys stay in memory on this local server.
          generateNarration({ document, slug, directory: store.dir('essay-assets', slug), apiKey, voiceId: input.voiceId || defaultVoice, narrator: input.narrator, sample: Boolean(input.sample), progress: update => jobs.set(slug, { ...jobs.get(slug), ...update }) })
            .then(async audio => {
              if (input.sample) {
                await mkdir(store.dir('workbench', slug), { recursive: true });
                await writeFile(join(store.dir('workbench', slug), 'narration-preview.md'), serializeEssay({ metadata: audio, body: 'A short voice audition, not the full essay recording.' }));
              }
              jobs.set(slug, { ...jobs.get(slug), state: 'complete', audio });
            })
            .catch(error => jobs.set(slug, { state: 'error', error: error.message }));
          return send({ state: 'running' }, 202);
        }
        if (action === 'media' && method === 'POST') {
          await store.get(slug);
          const input = await jsonBody(request), extension = extname(input.name || '').toLowerCase();
          const image = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(extension);
          const audio = ['.mp3', '.m4a', '.wav', '.ogg'].includes(extension);
          if ((!image && !audio) || typeof input.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw fail('Upload a PNG, JPG, WebP, GIF, AVIF, MP3, M4A, WAV or OGG file.');
          const data = Buffer.from(input.data, 'base64');
          if (!data.length || data.length > (image ? 12_000_000 : 60_000_000)) throw fail(image ? 'Images must be under 12 MB.' : 'Audio must be under 60 MB.', 413);
          const filename = `${randomUUID()}${extension}`;
          await mkdir(store.dir('essay-assets', slug), { recursive: true });
          await writeFile(join(store.dir('essay-assets', slug), filename), data);
          return send({ src: `../../assets/essays/${slug}/${filename}`, kind: image ? 'image' : 'audio' }, 201);
        }
        throw fail('Not found.', 404);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw fail('Method not allowed.', 405);
      let root, relative;
      if (path.startsWith('/assets/essays/')) { root = store.dir('essay-assets'); relative = path.slice('/assets/essays/'.length); }
      else if (path.startsWith('/assets/') || path.startsWith('/styles/') || path === '/scripts/essay.js') { root = join(project, 'site'); relative = path.slice(1); }
      else { root = join(project, 'studio'); relative = path === '/' ? 'index.html' : path.slice(1); }
      const target = resolve(root, relative);
      if (!target.startsWith(resolve(root) + sep)) throw fail('Not found.', 404);
      let data; try { data = await readFile(target); } catch { throw fail('Not found.', 404); }
      const headers = { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: http: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'", 'Accept-Ranges': 'bytes' };
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        if (start > end || start >= data.length) { response.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); return response.end(); }
        response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 }); return response.end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
      }
      response.writeHead(200, { ...headers, 'Content-Length': data.length }); response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) { send({ error: error.status ? error.message : error.code === 'ENOENT' ? 'File not found.' : error.message || 'Unable to complete the request.' }, error.status || (error.code === 'ENOENT' ? 404 : 400)); }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.STUDIO_PORT || 4310);
  const server = await createStudioServer();
  server.listen(port, '127.0.0.1', () => console.log(`Essay Studio: http://127.0.0.1:${port}/`));
}
