// Run after a verified import. Removes private files from Git's index only.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { snapshotFiles } from '../server/migration.mjs';
import { referencedAssets } from '../server/media.mjs';

const verified = JSON.parse(await readFile('.local/essay-studio/migration-verified.json', 'utf8'));
const snapshot = await snapshotFiles('content');
if (!verified.verified || snapshot.id !== verified.id) throw new Error('Verify a fresh import before untracking private material.');
const publicAssets = new Set();
const tracked = execFileSync('git', ['ls-files', '-z', 'content'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const path of tracked.filter(path => /^content\/essays\/[^_][^/]+\.md$/.test(path) && !path.endsWith('/README.md'))) {
  const slug = path.split('/').at(-1).slice(0, -3), source = await readFile(path, 'utf8');
  for (const file of referencedAssets(source, slug)) publicAssets.add(`content/essay-assets/${slug}/${file}`);
}
const privatePaths = tracked.filter(path => path.startsWith('content/drafts/') || path.startsWith('content/workbench/') || path.startsWith('content/essay-assets/') && !publicAssets.has(path));
if (privatePaths.length) execFileSync('git', ['rm', '--cached', '--', ...privatePaths], { stdio: 'ignore' });
console.log(`${privatePaths.length} private files removed from the Git index. Local originals and Git history are unchanged.`);
