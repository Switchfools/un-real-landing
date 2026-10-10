import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { pgliteDatabase } from '../server/database.mjs';
import { Workspace } from '../server/workspace.mjs';
import { authenticator } from '../server/auth.mjs';
import { MediaService, referencedAssets } from '../server/media.mjs';
import { Jobs } from '../server/jobs.mjs';
import { Narration } from '../server/narration.mjs';
import { Releases } from '../server/releases.mjs';
import { GitHubPublisher } from '../server/github.mjs';
import { snapshotFiles, importFiles, exportOriginalFiles, backupWorkspace, restoreWorkspace } from '../server/migration.mjs';
import { hash, serializeEssay, parseEssay, narrationHash } from '../scripts/essays.mjs';
import { fixtureSource } from './studio-fixture.mjs';

const human = { owner: 'github:123', userId: 'owner', clientId: null }, ai = { ...human, clientId: 'chatgpt', permissions: ['read', 'propose'] };
async function fixture(t) {
  const pg = new PGlite(); await pg.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const db = pgliteDatabase(pg); t.after(() => db.close());
  const workspace = new Workspace(db), bytes = new Map();
  const storage = {
    uploadTicket: async asset => ({ url: 'https://s3.example.com', fields: { key: asset.key } }),
    put: async (asset, value) => { bytes.set(asset.key, value); return { ...asset, versionId: randomUUID() }; },
    read: async asset => bytes.get(asset.key), download: async asset => `https://s3.example.com/${asset.key}?signed=true`,
    head: async asset => ({ size: bytes.get(asset.key)?.length, type: asset.type, checksum: Buffer.from(hash(bytes.get(asset.key)), 'hex').toString('base64'), versionId: 'frozen-version' }),
  };
  const media = new MediaService(workspace, storage), jobs = new Jobs(workspace);
  return { pg, db, workspace, bytes, media, storage, jobs };
}

test('JWT audience, verified GitHub identity, explicit grant and revocation isolate human and MCP credentials', async t => {
  const { db, workspace } = await fixture(t), pair = await generateKeyPair('ES256');
  const jwk = await exportJWK(pair.publicKey), jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'ES256' }] });
  const config = { origin: 'https://studio.example.com', supabaseUrl: 'https://studio.supabase.co', ownerGithubId: '123' };
  let providerId = '123';
  const admin = { auth: { admin: { getUserById: async () => ({ data: { user: { identities: [{ provider: 'github', identity_data: { provider_id: providerId } }], user_metadata: { provider_id: '123' } } } }) } } };
  const authenticate = authenticator(config, db, { jwks, admin });
  const request = async (claims = {}, audience = 'authenticated', issuer = `${config.supabaseUrl}/auth/v1`) => new Request(config.origin, { headers: { Authorization: `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).setSubject('owner').setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey)}` } });
  assert.equal((await authenticate(await request())).owner, human.owner);
  await assert.rejects(authenticate(await request({ client_id: 'chatgpt' })), /OAuth clients/);
  await assert.rejects(authenticate(await request({}, `${config.origin}/mcp`), true), /OAuth/);
  await assert.rejects(authenticate(await request({ client_id: 'chatgpt' }, `${config.origin}/mcp`), true), /approved/);
  await workspace.tx(human, tx => tx.put('grant', 'chatgpt', { userId: 'owner', revoked: false, permissions: ['read'] }));
  assert.deepEqual((await authenticate(await request({ client_id: 'chatgpt' }, `${config.origin}/mcp`), true)).permissions, ['read']);
  await workspace.tx(human, tx => tx.put('grant', 'chatgpt', { userId: 'owner', revoked: true }));
  await assert.rejects(authenticate(await request({ client_id: 'chatgpt' }, `${config.origin}/mcp`), true), /revoked/);
  providerId = 'another-person'; await assert.rejects(authenticate(await request()), /private/);
  await assert.rejects(authenticate(await request({}, 'authenticated', 'https://forged.example.com')), /invalid/);
});

test('database grants deny OAuth table access and runtime RLS isolates owners', async t => {
  const { pg, workspace } = await fixture(t);
  await workspace.create(human, 'a-belief', fixtureSource);
  await pg.exec('CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE essay_studio_api NOINHERIT NOBYPASSRLS;');
  await pg.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  await pg.exec('SET ROLE authenticated');
  await assert.rejects(pg.query('SELECT * FROM essay_studio.records'), /permission denied/);
  await assert.rejects(pg.query("INSERT INTO essay_studio.records VALUES('github:123','essay','attack','{}')"), /permission denied/);
  await pg.exec('RESET ROLE; SET ROLE essay_studio_api');
  await pg.query("SELECT set_config('essay_studio.owner','github:other',false)");
  assert.equal((await pg.query('SELECT * FROM essay_studio.records')).rows.length, 0);
  await assert.rejects(pg.query("INSERT INTO essay_studio.records(owner,kind,id,data) VALUES('github:123','essay','attack','{}')"), /row-level security/);
  await pg.exec('RESET ROLE');
});

test('media validates ownership, size and checksum and pins verified objects', async t => {
  const { workspace, media, bytes } = await fixture(t); await workspace.create(human, 'a-belief', fixtureSource);
  const input = { name: 'photo.png', size: 4, checksum: Buffer.from(hash('test'), 'hex').toString('base64') };
  await assert.rejects(media.ticket(ai, 'a-belief', input), /Studio session/);
  await assert.rejects(media.ticket(human, 'a-belief', { ...input, size: 12_000_001 }), /12 MB/);
  await assert.rejects(media.ticket({ ...human, owner: 'other' }, 'a-belief', input), /Not found/);
  const ticket = await media.ticket(human, 'a-belief', input), asset = await workspace.tx(human, tx => tx.get('asset', ticket.id));
  bytes.set(asset.key, Buffer.from('bad')); await assert.rejects(media.complete(human, ticket.id), /declared/);
  bytes.set(asset.key, Buffer.from('test')); const ready = await media.complete(human, ticket.id);
  assert.equal(ready.src, `../../assets/essays/${ticket.id}`);
  assert.equal((await workspace.tx(human, tx => tx.get('asset', ticket.id))).versionId, 'frozen-version');
  assert.deepEqual(await media.complete(human, ticket.id), ready);
  await assert.rejects(media.complete({ ...human, owner: 'other' }, ticket.id), /Not found/);
  assert.doesNotMatch(await media.urls(human, '<img src="https://tracker.example.com/pixel">'), /tracker/);
  assert.throws(() => referencedAssets(fixtureSource + '\n![external][image]\n\n[image]: https://tracker.example.com/image.png', 'a-belief'), /Upload images/);
});

test('narration resumes cached parts, requires explicit retry after uncertainty, and finishes after a worker restart', async t => {
  const { workspace, media, jobs } = await fixture(t);
  const current = await workspace.create(human, 'a-belief', fixtureSource); let calls = 0, fail = true;
  const narration = new Narration(workspace, media, jobs, { getAudio: async () => ({ apiKey: 'test-key' }) }, async () => { calls++; if (fail) throw new Error('connection lost'); return new Response(Buffer.from('audio'), { headers: { 'Content-Type': 'audio/mpeg' } }); });
  const input = { requestId: randomUUID(), ...current, voiceId: 'test-voice', narrator: 'Test voice', sample: true };
  await assert.rejects(narration.start(ai, current.slug, input), /Studio session/);
  const job = await narration.start(human, current.slug, input); assert.equal((await narration.start(human, current.slug, input)).id, job.id);
  await jobs.run(human, job.id, value => narration.part(human, value));
  assert.equal((await narration.status(human, current.slug)).uncertain, true);
  await jobs.run(human, job.id, value => narration.part(human, value)); assert.equal(calls, 1);
  fail = false; await jobs.retry(human, job.id); await jobs.run(human, job.id, value => narration.part(human, value));
  assert.equal((await narration.status(human, current.slug)).state, 'complete'); assert.equal(calls, 2);
  await narration.ack(human, current.slug);
  const cached = await narration.start(human, current.slug, { ...input, requestId: randomUUID() });
  await jobs.run(human, cached.id, value => narration.part(human, value)); assert.equal(calls, 2);
  // Crash after last part is durable but before the worker marks the job complete.
  await workspace.tx(human, async tx => { const row = await tx.get('job', cached.id); await tx.put('job', cached.id, { ...row, state: 'running', leaseUntil: new Date(0).toISOString() }); });
  await jobs.run(human, cached.id, value => narration.part(human, value));
  assert.equal((await narration.status(human, current.slug)).state, 'complete'); assert.equal(calls, 2);
  const attached = await workspace.save(human, current.slug, { ...current, metadata: { ...current.metadata, audio: { narrator: 'Test', ai_generated: true, source_hash: narrationHash(current), tracks: [{ title: 'Part', src: '../../assets/essays/a-belief/test.mp3' }] } }, body: 'Changed text' });
  const releases = new Releases(workspace, {}, media, jobs);
  await assert.rejects(releases.prepare(human, current.slug, attached), /out of date/);
});

test('GitHub publishing uses only release files, refuses conflicts and waits for matching Pages success', async () => {
  const github = new GitHubPublisher({ repo: 'Switchfools/un-real-landing' });
  let head = 'base', tree, changed = 0, workflow = 'in_progress', deployment = 'pending';
  github.head = async () => head;
  github.request = async (path, options = {}) => {
    if (path === '/git/commits/base') return { tree: { sha: 'base-tree' } };
    if (path === '/git/blobs') return { sha: hash(options.body.content) };
    if (path === '/git/trees') { tree = options.body; return { sha: 'tree' }; }
    if (path === '/git/commits') return { sha: 'release-commit' };
    if (path === '/git/refs/heads/main') { assert.equal(options.body.force, false); head = options.body.sha; changed++; return {}; }
    if (path.startsWith('/compare/')) return { status: 'diverged' };
    if (path.startsWith('/actions/workflows/')) { assert.match(path, /head_sha=release-commit/); return { workflow_runs: [{ id: 1, status: workflow, conclusion: 'success', html_url: 'https://github.com/run' }] }; }
    if (path.startsWith('/deployments?')) return [{ id: 2 }];
    if (path.startsWith('/deployments/2/')) return [{ state: deployment, environment_url: 'https://example.com' }];
    throw new Error(path);
  };
  const release = { id: randomUUID(), baseCommit: 'base', slug: 'a-belief', source: fixtureSource, title: 'A belief', confirmedAt: '2026-10-08T00:00:00Z' };
  const commitSha = await github.prepareCommit(release, [{ filename: 'image.png', bytes: Buffer.from('image') }]);
  assert.deepEqual(tree.tree.map(file => file.path), ['content/essays/a-belief.md', 'content/essay-assets/a-belief/image.png']);
  await github.advance({ ...release, commitSha }); await github.advance({ ...release, commitSha }); assert.equal(changed, 1);
  head = 'conflict'; await assert.rejects(github.prepareCommit(release, []), /changed/); await assert.rejects(github.advance({ ...release, commitSha }), /changed/);
  assert.equal((await github.deployment(commitSha)).state, 'deploying'); workflow = 'completed';
  assert.equal((await github.deployment(commitSha)).state, 'deploying'); deployment = 'success';
  assert.equal((await github.deployment(commitSha)).state, 'live');
});

test('migration preserves exact Markdown, comments, history, previews and media; backup restores privately', async t => {
  const { workspace, media } = await fixture(t), second = await fixture(t);
  const root = await mkdtemp(join(tmpdir(), 'essay-import-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['drafts', 'workbench/a-belief/revisions', 'workbench/a-belief/releases', 'essay-assets/a-belief']) await mkdir(join(root, folder), { recursive: true });
  const original = fixtureSource.replaceAll('\n', '\r\n');
  await writeFile(join(root, 'drafts/a-belief.md'), original);
  await writeFile(join(root, 'workbench/a-belief/revisions/original.md'), original);
  await writeFile(join(root, 'workbench/a-belief/releases/123.md'), original);
  await writeFile(join(root, 'workbench/a-belief/comments.md'), serializeEssay({ metadata: { comments: [{ id: 'note', field: 'body', quote: 'passage', text: 'Clarify', resolved: false }] }, body: 'One note.' }));
  await writeFile(join(root, 'workbench/a-belief/narration-preview.md'), serializeEssay({ metadata: { narrator: 'Test', tracks: [{ src: '../../assets/essays/a-belief/sample.mp3' }] }, body: 'Sample' }));
  await writeFile(join(root, 'essay-assets/a-belief/sample.mp3'), Buffer.from('recording'));
  const snapshot = await snapshotFiles(root), backup = async bytes => ({ sha256: hash(bytes) });
  const result = await importFiles(workspace, human, snapshot, media, backup);
  assert.equal(result.verified, true); assert.equal(result.fileCount, 6); assert.equal(result.mediaCount, 1);
  assert.equal((await workspace.get(human, 'a-belief')).source, original);
  assert.equal((await workspace.get(human, 'a-belief')).comments[0].text, 'Clarify');
  assert.equal((await workspace.tx(human, tx => tx.get('settings', 'narration-preview:a-belief'))).narrator, 'Test');
  assert.equal((await importFiles(workspace, human, snapshot, media, backup)).verified, true);
  const exported = join(root, 'export'); await exportOriginalFiles(workspace, human, media, exported);
  assert.deepEqual((await snapshotFiles(exported)).manifest, snapshot.manifest);
  await workspace.tx(human, tx => tx.put('grant', 'chatgpt', { revoked: false }));
  await restoreWorkspace(second.workspace, human, second.media, await backupWorkspace(workspace, human, media));
  assert.equal((await second.workspace.get(human, 'a-belief')).source, original);
  assert.equal((await second.workspace.tx(human, tx => tx.get('grant', 'chatgpt'))).revoked, true);
  await assert.rejects(restoreWorkspace(second.workspace, human, second.media, await backupWorkspace(workspace, human, media)), /empty database/);
});
