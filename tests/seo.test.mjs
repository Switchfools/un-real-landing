import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { buildSite } from '../scripts/build.mjs';
import { studioRoutes, studioDomain } from '../infra/domain.mjs';

test('published SEO artifacts agree on canonical URLs, escape author text and exclude private material', async t => {
  const root = await mkdtemp(join(tmpdir(), 'unreal-seo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contentDir = join(root, 'content'), assetsDir = join(root, 'private-assets'), outDir = join(root, 'dist');
  await mkdir(contentDir); await mkdir(assetsDir);
  const source = await readFile('tests/fixtures/essays/from-belief-to-action.md', 'utf8');
  const dangerousTitle = 'Human judgment </script><script>alert("x")</script> & AI';
  await writeFile(join(contentDir, 'agency.md'), source.replace(/^title:.*$/m, `title: ${JSON.stringify(dangerousTitle)}`));
  await writeFile(join(contentDir, 'private-idea.md'), source.replace('draft: false', 'draft: true').replace(/^title:.*$/m, 'title: Confidential idea'));
  await writeFile(join(assetsDir, 'private-note.png'), 'Private bytes must stay private.');
  for (const siteUrl of ['https://un-real.ai/', 'https://switchfools.github.io/un-real-landing/']) {
    await buildSite({ contentDir, assetsDir, outDir, siteUrl });
    const page = await readFile(join(outDir, 'essays/agency/index.html'), 'utf8');
    const schema = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const article = schema['@graph'].find(node => node['@type'] === 'BlogPosting');
    assert.equal(article.headline, dangerousTitle);
    assert.equal(article.url, `${siteUrl}essays/agency/`);
    assert.equal(article.mainEntityOfPage, article.url);
    assert.equal(article.datePublished, '2026-09-23');
    assert.ok(article.author.name);
    assert.match(page, new RegExp(`rel="canonical" href="${article.url.replaceAll('.', '\\.')}"`));
    assert.ok(page.includes(`property="og:url" content="${article.url}"`));
    assert.ok(page.includes(`name="twitter:image" content="${article.image}"`));
    assert.doesNotMatch(page, /<script>alert/);
    const png = await readFile(join(outDir, article.image.slice(siteUrl.length)));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
    for (const path of ['sitemap.xml', 'feed.xml', 'essays/index.html']) {
      const output = await readFile(join(outDir, path), 'utf8');
      assert.ok(output.includes(article.url));
      assert.doesNotMatch(output, /private-idea|Confidential idea|studio\.un-real\.ai|_template/);
    }
    const robots = await readFile(join(outDir, 'robots.txt'), 'utf8');
    assert.ok(robots.includes(`Sitemap: ${siteUrl}sitemap.xml`));
    assert.doesNotMatch(robots, /Disallow: \/\s/);
    assert.ok(!(await readdir(join(outDir, 'assets'), { recursive: true })).some(path => path.includes('private-note')));
    const rss = await readFile(join(outDir, 'feed.xml'), 'utf8');
    assert.match(rss, /&lt;\/script&gt;/); assert.doesNotMatch(rss, /<script>/);
  }
});

test('Studio domain redirect preserves OAuth and proposal queries and rewrites only its application routes', () => {
  const handler = runInNewContext(`${studioRoutes}; handler`);
  const request = { uri: '/auth/callback', headers: { host: { value: 'du33fyw9w0t2v.cloudfront.net' } }, querystring: { code: { value: 'code%2Fvalue' }, proposal: { value: 'id' }, version: { value: '2' } } };
  const redirect = handler({ request });
  assert.equal(redirect.statusCode, 301);
  assert.equal(redirect.headers.location.value, `https://${studioDomain}/auth/callback?code=code%2Fvalue&proposal=id&version=2`);
  request.headers.host.value = studioDomain;
  assert.equal(handler({ request }).uri, '/index.html');
  request.uri = '/studio.js';
  assert.equal(handler({ request }).uri, '/studio.js');
});
