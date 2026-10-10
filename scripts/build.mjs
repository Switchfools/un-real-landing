import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEssay, validateEssay, renderArticle, escape, displayDate, wordCount, validSlug } from './essays.mjs';
import { SITE_URL, HOME_TITLE, HOME_DESCRIPTION, ESSAYS_TITLE, ESSAYS_DESCRIPTION, absolute, metadata, siteSchema, articleSchema, sitemap, feed } from './seo.mjs';
import { socialCard } from './social-card.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
async function readEssays(directory) {
  const essays = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('_') || entry.name === 'README.md') continue;
    const source = await readFile(join(directory, entry.name), 'utf8');
    let document;
    try { document = parseEssay(source); } catch (error) { throw new Error(`${entry.name}: ${error.message}`); }
    if (document.metadata.draft === true) continue;
    try { validateEssay(document, true); } catch (error) { throw new Error(`${entry.name}: ${error.message}`); }
    const slug = entry.name.slice(0, -3);
    if (!validSlug(slug)) throw new Error(`${entry.name}: use a lowercase, hyphen-separated filename.`);
    essays.push({ ...document.metadata, ...document, slug, words: wordCount(document.body), minutes: Math.max(1, Math.ceil(wordCount(document.body) / 220)) });
  }
  return essays.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

function essayList(essays, prefix = './essays/') {
  return `<ol class="essay-list">${essays.map(essay => `
          <li><a class="essay-link" href="${prefix}${essay.slug}/">
            <span class="essay-meta"><time datetime="${essay.date}">${displayDate(essay.date)}</time>${essay.minutes} min read</span>
            <div><h3>${escape(essay.title)}</h3><p>${escape(essay.description)}</p></div>
            <span class="essay-arrow" aria-hidden="true">↗</span>
          </a></li>`).join('')}
        </ol>`;
}

function layout(home, prefix) {
  const relative = html => html.replaceAll('href="./', `href="${prefix}`).replaceAll('href="#', `href="${prefix}#`).replaceAll('src="./', `src="${prefix}`);
  const header = relative(home.match(/<header class="site-header shell">[\s\S]*?<\/header>/)[0]);
  const footer = relative(home.match(/<footer class="site-footer shell">[\s\S]*?<\/footer>/)[0]);
  return { header, footer };
}

function essayPage(essay, essays, home, base) {
  const { header, footer } = layout(home, '../../');
  const url = absolute(`essays/${essay.slug}/`, base);
  const more = essays.filter(other => other.slug !== essay.slug).slice(0, 3);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111310">
  ${metadata({ base, title: `${essay.title} — un-real.ai`, description: essay.description, path: `essays/${essay.slug}/`, image: essay.socialImage, imageAlt: `${essay.title} — ${essay.author} — un-real.ai`, article: essay, schema: articleSchema(essay, base) })}
  <link rel="icon" type="image/svg+xml" href="../../assets/brand/favicon.svg">
  <link rel="apple-touch-icon" href="../../assets/brand/apple-touch-icon.png">
  <link rel="stylesheet" href="../../styles/main.css">
  <script type="module" src="../../scripts/essay.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${header}
  <main id="main" class="shell">
    <nav class="essay-back" aria-label="Breadcrumb"><a href="../../">un-real.ai</a><span aria-hidden="true"> / </span><a href="../">All essays</a></nav>
    ${renderArticle(essay)}
    <section class="essay-share" aria-label="Share this essay" data-essay-share data-url="${escape(url)}" data-title="${escape(essay.title)}">
      <h2>Give the idea somewhere to go.</h2><p>Share it with someone who will question it, test it, or put it to work.</p>
      <div class="share-links"><button type="button" data-copy-link hidden>Copy link</button><button type="button" data-native-share hidden>Share essay</button><a href="${escape(url)}">Permanent link</a><a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">Share on LinkedIn ↗</a><a href="../../feed.xml">Follow via RSS</a></div><p role="status" data-share-status></p>
    </section>
    <section class="essay-mission"><h2>Ideas in service of a shared future.</h2><p>Our mission is AI alignment, beneficial coexistence, and human–AI symbiosis. Each essay is an invitation to turn understanding into action.</p><a class="text-link" href="../../#mission">Explore the mission →</a></section>
    ${more.length ? `<section class="more-essays" aria-labelledby="more-essays-title"><h2 id="more-essays-title">Continue reading</h2>${essayList(more, '../')}</section>` : ''}
  </main>
  ${footer}
</body>
</html>
`;
}

function essaysPage(essays, home, base) {
  const { header, footer } = layout(home, '../');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#111310">
  ${metadata({ base, title: `${ESSAYS_TITLE} — un-real.ai`, description: ESSAYS_DESCRIPTION, path: 'essays/', schema: siteSchema(base, essays, true) })}
  <link rel="icon" type="image/svg+xml" href="../assets/brand/favicon.svg"><link rel="stylesheet" href="../styles/main.css"></head><body>
  <a class="skip-link" href="#main">Skip to content</a>${header}<main class="shell essays-archive" id="main"><p class="eyebrow">Essays &amp; convictions</p><h1>AI alignment.<br>Human–AI symbiosis.<br><em>Ideas into action.</em></h1><p class="archive-intro">Essays on human agency, coexistence, and a flourishing future with AI. Read the reasoning, question the assumptions, and take one concrete next step.</p>
  ${essays.length ? essayList(essays, './') : '<div class="essays-empty"><p>Essays will be published here. Each one will point toward a concrete next step.</p></div>'}
  <div class="essays-footer"><a class="text-link" href="../#mission">Explore the mission →</a><a class="text-link" href="../feed.xml">Follow via RSS →</a></div></main>${footer}</body></html>`;
}

function notFoundPage(base) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, follow"><title>Page not found — un-real.ai</title><link rel="stylesheet" href="./styles/main.css"></head><body><main id="main" class="shell essays-archive"><p class="eyebrow">un-real.ai / 404</p><h1>This page isn’t here.</h1><p class="archive-intro">An idea may have moved. Continue with the mission or explore the published essays.</p><div class="share-links"><a href="${escape(base)}">Our mission →</a><a href="${escape(absolute('essays/', base))}">Explore the essays →</a></div></main></body></html>`;
}

async function versionRuntime(output) {
  const name = (basename, source, extension) => `${basename}.${createHash('sha256').update(source).digest('hex').slice(0, 12)}.${extension}`;
  const math = await readFile(join(output, 'scripts/lorenz.js'), 'utf8');
  const mathName = name('lorenz', math, 'js');
  const entry = (await readFile(join(output, 'scripts/attractor.js'), 'utf8')).replace("'./lorenz.js'", `'./${mathName}'`);
  const entryName = name('attractor', entry, 'js');
  const css = await readFile(join(output, 'styles/main.css'), 'utf8');
  const cssName = name('main', css, 'css');
  // Reference matching CSS and JS, including the imported math module, so a
  // browser cannot combine cached code with a different deployment's files.
  for (const [original, versioned, source] of [
    ['scripts/lorenz.js', `scripts/${mathName}`, math],
    ['scripts/attractor.js', `scripts/${entryName}`, entry],
    ['styles/main.css', `styles/${cssName}`, css],
  ]) {
    await writeFile(join(output, versioned), source);
    await rm(join(output, original));
  }
  const essayScript = await readFile(join(output, 'scripts/essay.js'), 'utf8');
  const essayScriptName = name('essay', essayScript, 'js');
  await writeFile(join(output, 'scripts', essayScriptName), essayScript);
  await rm(join(output, 'scripts/essay.js'));
  const versions = { 'scripts/essay.js': `scripts/${essayScriptName}`, 'scripts/attractor.js': `scripts/${entryName}`, 'styles/main.css': `styles/${cssName}` };
  return html => html.replace(/((?:href|src)="(?:\.\/|(?:\.\.\/)+))(scripts\/attractor\.js|scripts\/essay\.js|styles\/main\.css)"/g,
    (_, prefix, asset) => `${prefix}${versions[asset]}"`);
}

export async function buildSite({ contentDir = join(projectRoot, 'content/essays'), outDir = join(projectRoot, 'dist'), assetsDir = join(projectRoot, 'content/essay-assets'), siteUrl = SITE_URL } = {}) {
  const base = new URL(siteUrl).href;
  if (!base.startsWith('https://') || !base.endsWith('/') || new URL(base).search || new URL(base).hash) throw new Error('Use an HTTPS site URL ending in /, without a query or fragment.');
  // Parse and validate before touching output. Only the generated tree is replaced.
  const essays = await readEssays(contentDir);
  // Only media actually referenced by published essays enters the public artifact.
  const media = new Map();
  for (const essay of essays) {
    const references = JSON.stringify(essay.metadata) + essay.body;
    for (const match of references.matchAll(/\.\.\/\.\.\/assets\/essays\/([a-z0-9-]+\/[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp|gif|avif|mp3|m4a|wav|ogg))/g)) {
      const relative = match[1];
      try { media.set(relative, await readFile(join(assetsDir, relative))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; /* Legacy site/assets paths are copied below. */
        try { await readFile(join(projectRoot, 'site/assets/essays', relative)); }
        catch { throw new Error(`${essay.slug}: missing media ${relative}`); }
      }
    }
  }
  const home = (await readFile(join(projectRoot, 'site/index.html'), 'utf8')).replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, `<!-- seo:start -->\n${metadata({ base, title: HOME_TITLE, description: HOME_DESCRIPTION, schema: siteSchema(base) })}\n<!-- seo:end -->`);
  if (!home.includes('<!-- essays:start -->') || !home.includes('<!-- essays:end -->')) throw new Error('Missing essays markers in site/index.html.');
  const output = resolve(outDir);
  if (output === projectRoot || basename(output) !== 'dist') {
    throw new Error('Build output must be a generated directory named dist.');
  }
  if (['site', 'content', 'scripts', 'tests', '.git'].some(name => output === join(projectRoot, name) || output.startsWith(join(projectRoot, name) + '/'))) {
    throw new Error('Build output cannot overwrite source files.');
  }
  await rm(output, { recursive: true, force: true });
  await cp(join(projectRoot, 'site'), output, { recursive: true });
  for (const [relative, data] of media) {
    await mkdir(join(output, 'assets/essays', relative.split('/')[0]), { recursive: true });
    await writeFile(join(output, 'assets/essays', relative), data);
  }
  const versionAssets = await versionRuntime(output);
  const homepage = essays.length ? home.replace(/<!-- essays:start -->[\s\S]*?<!-- essays:end -->/, `<!-- essays:start -->\n        ${essayList(essays)}\n        <!-- essays:end -->`) : home;
  await writeFile(join(output, 'index.html'), versionAssets(homepage));
  await mkdir(join(output, 'essays'), { recursive: true });
  await writeFile(join(output, 'essays/index.html'), versionAssets(essaysPage(essays, home, base)));
  await writeFile(join(output, 'sitemap.xml'), sitemap(essays, base));
  await writeFile(join(output, 'feed.xml'), feed(essays, base));
  await writeFile(join(output, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${absolute('sitemap.xml', base)}\n`);
  await writeFile(join(output, '404.html'), versionAssets(notFoundPage(base)).replace('href="./styles/', `href="${escape(absolute('styles/', base))}`));
  if (base === SITE_URL) await writeFile(join(output, 'CNAME'), 'un-real.ai\n');
  for (const essay of essays) {
    const card = await socialCard(essay);
    essay.socialImage = `assets/social/${essay.slug}.${createHash('sha256').update(card).digest('hex').slice(0, 12)}.png`;
    await mkdir(join(output, 'assets/social'), { recursive: true });
    await writeFile(join(output, essay.socialImage), card);
    const directory = join(output, 'essays', essay.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), versionAssets(essayPage(essay, essays, home, base)));
  }
  return essays.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await buildSite();
  console.log(`Built dist/ with ${count} published essay${count === 1 ? '' : 's'}.`);
}
