import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStudioServer } from '../scripts/studio.mjs';

const root = await mkdtemp(join(tmpdir(), 'unreal-studio-browser-'));
await mkdir(join(root, 'drafts'));
await cp(resolve('content/drafts/the-imperfect-wish.md'), join(root, 'drafts/the-imperfect-wish.md'));
const server = await createStudioServer({ contentRoot: root });
server.listen(4311, '127.0.0.1');
const close = () => server.close(async () => { await rm(root, { recursive: true, force: true }); process.exit(); });
process.on('SIGTERM', close); process.on('SIGINT', close);
