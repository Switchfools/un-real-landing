import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDatabase } from '../server/database.mjs';
import { Workspace } from '../server/workspace.mjs';
import { serializeEssay } from '../scripts/essays.mjs';
import { Jobs } from '../server/jobs.mjs';
import { Releases } from '../server/releases.mjs';
import { createApp } from '../server/app.mjs';

const human = { owner: 'github:123', userId: 'owner', clientId: null, permissions: ['read', 'propose'] };
const ai = { ...human, clientId: 'chatgpt' };
const doc = (body = '## A belief\n\nHuman agency matters.') => ({ metadata: { title: 'A belief', description: 'Human agency.', author: 'Nicolás', date: '2026-10-08', summary: 'Keep the choice human.', action: 'Review one decision.', draft: true }, body });
async function fixture(t) {
  const pg = new PGlite(); await pg.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const db = pgliteDatabase(pg); t.after(() => db.close());
  const workspace = new Workspace(db); return { pg, db, workspace };
}
const proposal = (current, body = '## A belief\n\nAI supports human judgment.') => ({ requestId: randomUUID(), slug: current?.slug || 'a-belief', baseRevision: current?.revision ?? null, commentsRevision: current?.commentsRevision ?? null, source: serializeEssay(doc(body)), summary: 'Clarify the role of AI.', resolveCommentIds: [] });

test('new essays and revised proposals require acceptance of the exact immutable version', async t => {
  const { workspace, db } = await fixture(t);
  const input = proposal(null), first = await workspace.propose(ai, input);
  assert.deepEqual(await workspace.list(human), []);
  assert.deepEqual(await workspace.propose(ai, input), first);
  const second = await workspace.propose(ai, { ...input, requestId: randomUUID(), source: serializeEssay(doc('A more careful argument.')), proposalId: first.id, expectedVersion: 1 }, true);
  assert.equal(second.version, 2);
  assert.equal((await workspace.proposal(human, first.id, 1)).version, 1);
  await assert.rejects(workspace.decide(human, first.id, { requestId: randomUUID(), version: 1 }, true), /changed/);
  assert.throws(() => workspace.decide(ai, first.id, { requestId: randomUUID(), version: 2 }, true), /Studio session/);
  const acceptance = { requestId: randomUUID(), version: 2 };
  const accepted = await workspace.decide(human, first.id, acceptance, true);
  assert.equal(accepted.document.body, 'A more careful argument.');
  assert.deepEqual(await workspace.decide(human, first.id, acceptance, true), accepted);
  await assert.rejects(workspace.propose(ai, { ...input, summary: 'Reused ID with different contents' }), /request ID/);
  await assert.rejects(db.transaction(human.owner, tx => tx.put('proposal-version', `${first.id}/1`, {})), /immutable/);
  assert.equal((await workspace.get(human, 'a-belief')).published, false);
});

test('stale manuscripts, comments and simultaneous saves cannot overwrite another revision', async t => {
  const { workspace } = await fixture(t);
  let current = await workspace.create(human, 'a-belief', serializeEssay(doc()));
  const first = await workspace.propose(ai, proposal(current));
  const comment = { id: 'c1', field: 'body', quote: 'agency', text: 'Explain what agency means.', resolved: false };
  current = await workspace.save(human, current.slug, { ...current, comments: [comment] });
  await assert.rejects(workspace.decide(human, first.id, { requestId: randomUUID(), version: 1 }, true), /comments changed/);
  const input = { ...proposal(current), resolveCommentIds: ['c1'] }, refreshed = await workspace.propose(ai, input);
  const result = await workspace.decide(human, refreshed.id, { requestId: randomUUID(), version: 1 }, true);
  assert.equal(result.document.comments[0].resolved, true);
  const writes = await Promise.allSettled(['One', 'Two'].map(body => workspace.save(human, current.slug, { ...result.document, body })));
  assert.equal(writes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(writes.filter(value => value.status === 'rejected').length, 1);
  await assert.rejects(workspace.get({ ...human, owner: 'other' }, current.slug), /Not found/);
  assert.ok((await workspace.history(human, current.slug)).length >= 3);
});

test('rejecting keeps the manuscript intact and records the author decision', async t => {
  const { workspace } = await fixture(t);
  const current = await workspace.create(human, 'a-belief', serializeEssay(doc()));
  const change = await workspace.propose(ai, proposal(current));
  await workspace.decide(human, change.id, { requestId: randomUUID(), version: 1 }, false);
  assert.deepEqual(await workspace.get(human, current.slug), current);
  assert.equal((await workspace.proposal(human, change.id)).state, 'rejected');
  await assert.rejects(workspace.propose(ai, { ...proposal(current), source: serializeEssay({ ...doc(), metadata: { ...doc().metadata, audio: { narrator: 'AI', ai_generated: true, tracks: [{ title: 'Fake', src: '../../assets/essays/a-belief/fake.mp3' }] } } }) }), /Audio attachments/);
});

test('release confirmation freezes a reviewed snapshot; later edits cannot enter it', async t => {
  const { workspace } = await fixture(t);
  const jobs = new Jobs(workspace), github = { head: async () => 'a'.repeat(40), source: async () => '', prepareCommit: async release => { assert.equal(release.source.includes('A later thought'), false); return 'b'.repeat(40); }, advance: async () => {}, deployment: async () => ({ state: 'live', liveUrl: 'https://example.com/essay/' }) };
  const releases = new Releases(workspace, github, {}, jobs);
  const current = await workspace.create(human, 'a-belief', serializeEssay(doc()));
  const preview = await releases.prepare(human, current.slug, current);
  assert.throws(() => releases.confirm(ai, preview.id, { requestId: randomUUID(), reviewHash: preview.reviewHash }), /Studio session/);
  await assert.rejects(releases.confirm(human, preview.id, { requestId: randomUUID(), reviewHash: 'wrong' }), /exact release/);
  const confirmation = { requestId: randomUUID(), reviewHash: preview.reviewHash };
  await releases.confirm(human, preview.id, confirmation);
  await releases.confirm(human, preview.id, confirmation);
  assert.equal((await workspace.tx(human, tx => tx.list('job'))).length, 1);
  await workspace.save(human, current.slug, { ...current, body: 'A later thought' });
  await jobs.run(human, preview.id, job => releases.publishJob(human, job.input));
  const result = await releases.get(human, preview.id); assert.equal(result.state, 'live');
  assert.equal((await workspace.get(human, current.slug)).body, 'A later thought');
});

test('MCP exposes proposals but never approval, release or narration; API rejects OAuth clients', async t => {
  const { workspace } = await fixture(t);
  const config = { local: true, origin: 'http://127.0.0.1:4312', supabaseUrl: 'https://example.supabase.co' };
  const app = createApp({ config, workspace, authenticate: async (request, mcp) => { if (mcp) return ai; return ai; } });
  const response = await app.request('/api/proposals/anything/approve', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 403);
  const mcp = await app.fetch(new Request(`${config.origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
  const data = await mcp.json();
  assert.equal(mcp.status, 200);
  assert.ok(data.result.tools.some(tool => tool.name === 'propose_essay'));
  assert.ok(data.result.tools.every(tool => tool.securitySchemes[0].type === 'oauth2'));
  assert.ok(!data.result.tools.some(tool => /approve|publish|narration|revoke/.test(tool.name)));
});
