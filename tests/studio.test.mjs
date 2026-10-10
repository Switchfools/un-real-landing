import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../scripts/studio-store.mjs';
import { parseEssay, serializeEssay, renderMarkdown, renderArticle, narrationText, narrationHash, validateEssay } from '../scripts/essays.mjs';
import { splitNarration, generateNarration } from '../scripts/narration.mjs';
import { buildSite } from '../scripts/build.mjs';

const document = () => ({ metadata: { title: 'An imperfect wish', subtitle: 'Build for uncertainty', author: 'Nicolás & ChatGPT', description: 'An argument.', summary: 'Expect failure. Build independent safeguards.', date: '2026-10-08', draft: true, action: 'Test a safeguard.' }, body: '## The idea\n\nConsider an **imperfect wish**.[^1]\n\n[^1]: A source with a [link](https://example.com).\n' });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'unreal-studio-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new StudioStore(root); await store.init(); return { root, store };
}

test('Markdown round trips metadata, Unicode, multiline abstract and footnotes', () => {
  const doc = document();
  const restored = parseEssay(serializeEssay(doc));
  assert.deepEqual(restored.metadata, doc.metadata); assert.equal(restored.body, doc.body.trim());
  const html = renderArticle(doc);
  assert.ok(html.indexOf('The idea in brief') < html.indexOf('The full essay'));
  assert.match(html, /href="#the-idea"/); assert.match(html, /id="the-idea"/);
  assert.match(html, /id="note-1"/); assert.match(html, /href="#ref-1-1"/); assert.doesNotMatch(html, /\[\^1\]/);
});

test('preview and publication escape HTML, unsafe Markdown URLs, and metadata', () => {
  const result = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n![x](data:text/html,test)\n\n## Same\n\n## Same');
  assert.doesNotMatch(result.html, /<script>|href="javascript:|src="data:/);
  assert.match(result.html, /&lt;script&gt;/); assert.match(result.html, /id="same-2"/);
  assert.match(renderArticle({ ...document(), metadata: { ...document().metadata, title: '<img src=x onerror=alert(1)>' } }), /&lt;img/);
});

test('saving keeps Markdown revisions and comments, and rejects stale edits', async t => {
  const { root, store } = await fixture(t);
  const original = serializeEssay(document()); const initial = await store.create('the-wish', original);
  const comment = { id: 'note-1', field: 'body', quote: 'imperfect wish', text: 'Explain this.', resolved: false };
  const saved = await store.save('the-wish', { ...initial, body: initial.body + '\n\nA new thought.', comments: [comment] });
  assert.equal(saved.comments[0].text, 'Explain this.'); assert.equal(saved.metadata.draft, true);
  assert.match(await readFile(join(root, 'workbench/the-wish/comments.md'), 'utf8'), /> imperfect wish/);
  assert.equal(await store.revision('the-wish', 'original.md'), original);
  assert.equal((await store.history('the-wish')).length, 2);
  await assert.rejects(store.save('the-wish', initial), /changed on disk/);
  await assert.rejects(store.create('the-wish', original), /already exists/);
  await assert.rejects(store.create('../escape', original), /filename/);
  await assert.rejects(store.revision('the-wish', '../../drafts/the-wish.md'), /Invalid revision/);
});

test('simultaneous saves serialize; only one can replace the same revision', async t => {
  const { store } = await fixture(t); const doc = await store.create('wish', serializeEssay(document()));
  const results = await Promise.allSettled([store.save('wish', { ...doc, body: 'First writer' }), store.save('wish', { ...doc, body: 'Second writer' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});

test('release is explicit, blocks open notes and stale audio, preserves editable draft', async t => {
  const { root, store } = await fixture(t); let doc = await store.create('wish', serializeEssay(document()));
  assert.deepEqual(await readdir(join(root, 'essays')), []);
  doc = await store.save('wish', { ...doc, comments: [{ id: 'note', field: 'summary', quote: 'failure', text: 'Review', resolved: false }] });
  await assert.rejects(store.publish('wish', doc), /Resolve open comments/);
  doc.comments[0].resolved = true;
  doc = await store.save('wish', doc); await store.publish('wish', doc);
  const released = parseEssay(await readFile(join(root, 'essays/wish.md'), 'utf8'));
  assert.equal(released.metadata.draft, false); assert.equal((await store.get('wish')).metadata.draft, true);
  await store.save('wish', { ...doc, body: 'A later edit' });
  assert.equal(parseEssay(await readFile(join(root, 'essays/wish.md'), 'utf8')).body, released.body);
  const stale = document(); stale.metadata.audio = { narrator: 'Deep voice', ai_generated: true, source_hash: 'old', tracks: [{ title: 'Essay', src: '../../assets/essays/wish/read.mp3' }] };
  assert.throws(() => validateEssay(stale, true), /out of date/);
  stale.metadata.audio.source_hash = narrationHash(stale); assert.doesNotThrow(() => validateEssay(stale, true));
  stale.metadata.summary = 'word '.repeat(181); assert.throws(() => validateEssay(stale, true), /180 words/);
});

test('only final Markdown and referenced final assets enter the website', async t => {
  const { root, store } = await fixture(t);
  await store.create('private', serializeEssay(document()));
  const assetsDir = join(root, 'essay-assets'); await mkdir(join(assetsDir, 'wish'), { recursive: true });
  await writeFile(join(assetsDir, 'wish/used.png'), 'image'); await writeFile(join(assetsDir, 'wish/unused.png'), 'private-image');
  const doc = document(); doc.body += '\n![Diagram](../../assets/essays/wish/used.png)';
  const draft = await store.create('wish', serializeEssay(doc)); await store.publish('wish', draft);
  const outDir = join(root, 'dist'); await buildSite({ contentDir: join(root, 'essays'), outDir, assetsDir });
  assert.deepEqual(await readdir(join(outDir, 'essays')), ['index.html', 'wish']);
  assert.deepEqual(await readdir(join(outDir, 'assets/essays/wish')), ['used.png']);
  assert.ok(!(await readdir(outDir)).includes('studio')); assert.ok(!(await readdir(outDir)).includes('workbench'));
});

test('narration strips Markdown, splits long essays, caches generated parts and reports provider errors', async t => {
  const { root } = await fixture(t), doc = document();
  const text = narrationText(doc); assert.doesNotMatch(text, /\[\^1\]|\*\*|https:\/\/example/); assert.match(text, /imperfect wish/);
  const chunks = splitNarration('A sentence with words. '.repeat(1500)); assert.ok(chunks.length > 1); assert.ok(chunks.every(chunk => chunk.length <= 3500));
  let calls = 0;
  const fetcher = async (url, init) => { calls++; assert.match(url, /api.elevenlabs.io/); assert.equal(JSON.parse(init.body).voice_settings.speed, 0.92); return new Response('audio', { headers: { 'content-type': 'audio/mpeg', 'request-id': 'test-id' } }); };
  const options = { document: doc, slug: 'wish', directory: join(root, 'audio'), apiKey: 'test-key', voiceId: 'test-voice', narrator: 'Warm narrator', fetcher };
  const audio = await generateNarration(options); assert.equal(audio.ai_generated, true); assert.equal(audio.source_hash, narrationHash(doc));
  await generateNarration(options); assert.equal(calls, 1);
  await assert.rejects(generateNarration({ ...options, voiceId: 'other-voice', fetcher: async () => new Response('no credits', { status: 401 }) }), /401/);
});
