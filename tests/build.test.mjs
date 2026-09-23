import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from '../scripts/build.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'unreal-essays-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contentDir = join(root, 'content');
  const outDir = join(root, 'dist');
  await mkdir(contentDir);
  return { contentDir, outDir };
}

function essay({ title = 'An idea worth testing', date = '2026-09-23', draft = false, action = 'Test one assumption this week.' } = {}) {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: "A belief and its implications."\ndate: "${date}"\nauthor: "Test author"\ndraft: ${draft}\naction: ${JSON.stringify(action)}\n---\n\n## A question\n\nMake it **concrete**.\n`;
}

test('empty content produces an honest empty section without template or drafts', async t => {
  const options = await fixture(t);
  await writeFile(join(options.contentDir, '_template.md'), essay());
  await writeFile(join(options.contentDir, 'private-draft.md'), essay({ draft: true }));
  assert.equal(await buildSite(options), 0);
  const html = await readFile(join(options.outDir, 'index.html'), 'utf8');
  assert.match(html, /Essays will be published here/);
  assert.ok(!(await readdir(options.outDir)).includes('essays'));
});

test('published essays render Markdown, escaped metadata, dates and action, newest first', async t => {
  const options = await fixture(t);
  await writeFile(join(options.contentDir, 'older.md'), essay({ date: '2026-08-01' }));
  await writeFile(join(options.contentDir, 'newer.md'), essay({ title: 'Beliefs & <actions>' }));
  assert.equal(await buildSite(options), 2);
  const home = await readFile(join(options.outDir, 'index.html'), 'utf8');
  assert.ok(home.indexOf('./essays/newer/') < home.indexOf('./essays/older/'));
  assert.doesNotMatch(home, /Essays will be published here/);
  const page = await readFile(join(options.outDir, 'essays/newer/index.html'), 'utf8');
  assert.match(page, /Beliefs &amp; &lt;actions&gt;/);
  assert.match(page, /<strong>concrete<\/strong>/);
  assert.match(page, /From belief to action/);
  assert.match(page, /Test one assumption this week/);
  assert.match(page, /href="\.\.\/\.\.\/#essays"/);
  assert.match(page, /https:\/\/switchfools.github.io\/un-real-landing\/essays\/newer\//);
  // Unpublishing must remove old output, not leave a discoverable stale page.
  await writeFile(join(options.contentDir, 'newer.md'), essay({ draft: true }));
  await buildSite(options);
  assert.deepEqual(await readdir(join(options.outDir, 'essays')), ['older']);
});

test('a published essay needs a concrete action and valid publication date', async t => {
  const options = await fixture(t);
  const path = join(options.contentDir, 'essay.md');
  await writeFile(path, essay({ action: '' }));
  await assert.rejects(buildSite(options), /nonempty action/);
  await writeFile(path, essay({ date: '2026-02-30' }));
  await assert.rejects(buildSite(options), /valid YYYY-MM-DD/);
});
