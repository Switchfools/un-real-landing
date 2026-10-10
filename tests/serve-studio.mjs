import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStudioServer } from '../scripts/studio.mjs';
import { fixtureSource } from './studio-fixture.mjs';

const root = await mkdtemp(join(tmpdir(), 'unreal-studio-browser-'));
await mkdir(join(root, 'drafts'));
await writeFile(join(root, 'drafts/a-considered-idea.md'), fixtureSource);
const server = await createStudioServer({ contentRoot: root });
server.listen(4311, '127.0.0.1');
const close = () => server.close(async () => { await rm(root, { recursive: true, force: true }); process.exit(); });
process.on('SIGTERM', close); process.on('SIGINT', close);
