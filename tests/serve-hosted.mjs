import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedPreview } from '../scripts/serve-hosted-studio.mjs';
const root = await mkdtemp(join(tmpdir(), 'unreal-hosted-browser-'));
const app = await createHostedPreview({ root, port: 4312, fixture: true });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); await rm(root, { recursive: true, force: true }); process.exit(); });
