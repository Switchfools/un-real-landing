import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedPreview } from '../scripts/serve-hosted-studio.mjs';
import { randomUUID } from 'node:crypto';
import { serializeEssay } from '../scripts/essays.mjs';
import { visualizationExample } from '../site/scripts/visualization-schema.js';
const root = await mkdtemp(join(tmpdir(), 'unreal-hosted-browser-'));
const app = await createHostedPreview({ root, port: 4312, fixture: true });
// Historical proposals can predate visual validation. Seed them only in the
// browser fixture so recovery exercises the real read, revision and approval API.
for (const project of ['desktop', 'mobile', 'safari']) {
  const id = randomUUID(), slug = `legacy-visual-${project}`;
  const spec = { ...visualizationExample, fallback: { commands: [{ type: 'path', d: 'M0 0L50 50', stroke: '#bddad1', lineWidth: 94 }] } };
  const source = serializeEssay({ metadata: { title: 'A historical visual', draft: true }, body: 'Preserve this essay.\n\n```visualization\n' + JSON.stringify(spec) + '\n```' });
  await app.workspace.tx(app.identity, async tx => {
    await tx.insert('proposal', id, { id, slug, state: 'pending', version: 1, summary: 'A historical diagram with an invalid stroke.' });
    await tx.insert('proposal-version', `${id}/1`, { id, slug, version: 1, source, baseSource: '', baseRevision: null, commentsRevision: null, baseComments: [], resolveCommentIds: [], summary: 'A historical diagram with an invalid stroke.' });
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); await rm(root, { recursive: true, force: true }); process.exit(); });
