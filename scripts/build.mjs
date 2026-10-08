import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEssay, validateEssay, renderArticle, escape, displayDate, wordCount, validSlug } from './essays.mjs';

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
    essays.push({ ...document.metadata, ...document, slug, minutes: Math.max(1, Math.ceil(wordCount(document.body) / 220)) });
  }
  return essays.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

function essayList(essays) {
  return `<ol class="essay-list">${essays.map(essay => `
          <li><a class="essay-link" href="./essays/${essay.slug}/">
            <span class="essay-meta"><time datetime="${essay.date}">${displayDate(essay.date)}</time>${essay.minutes} min read</span>
            <div><h3>${escape(essay.title)}</h3><p>${escape(essay.description)}</p></div>
            <span class="essay-arrow" aria-hidden="true">↗</span>
          </a></li>`).join('')}
        </ol>`;
}

function essayPage(essay, home) {
  const base = home.match(/<link rel="canonical" href="([^"]+)"/)[1];
  const relative = html => html.replaceAll('href="./"', 'href="../../"').replaceAll('href="#', 'href="../../#').replaceAll('src="./', 'src="../../');
  const header = relative(home.match(/<header class="site-header shell">[\s\S]*?<\/header>/)[0]);
  const footer = relative(home.match(/<footer class="site-footer shell">[\s\S]*?<\/footer>/)[0]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111310">
  <title>${escape(essay.title)} — un-real.ai</title>
  <meta name="description" content="${escape(essay.description)}">
  <link rel="canonical" href="${escape(new URL(`essays/${essay.slug}/`, base).href)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="un-real.ai">
  <meta property="og:title" content="${escape(essay.title)}">
  <meta property="og:description" content="${escape(essay.description)}">
  <meta property="og:url" content="${escape(new URL(`essays/${essay.slug}/`, base).href)}">
  <meta property="og:image" content="${escape(new URL('assets/brand/social-preview.png', base).href)}">
  <meta property="article:published_time" content="${essay.date}T00:00:00Z">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="../../assets/brand/favicon.svg">
  <link rel="apple-touch-icon" href="../../assets/brand/apple-touch-icon.png">
  <link rel="stylesheet" href="../../styles/main.css">
  <script type="module" src="../../scripts/essay.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${header}
  <main id="main" class="shell">
    <a class="essay-back" href="../../#essays">← All essays</a>
    ${renderArticle(essay)}
  </main>
  ${footer}
</body>
</html>
`;
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
  return html => html.replace(/((?:href|src)="(?:\.\/|\.\.\/\.\.\/))(scripts\/attractor\.js|scripts\/essay\.js|styles\/main\.css)"/g,
    (_, prefix, asset) => `${prefix}${versions[asset]}"`);
}

export async function buildSite({ contentDir = join(projectRoot, 'content/essays'), outDir = join(projectRoot, 'dist'), assetsDir = join(projectRoot, 'content/essay-assets') } = {}) {
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
  const home = await readFile(join(projectRoot, 'site/index.html'), 'utf8');
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
  for (const essay of essays) {
    const directory = join(output, 'essays', essay.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), versionAssets(essayPage(essay, home)));
  }
  return essays.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await buildSite();
  console.log(`Built dist/ with ${count} published essay${count === 1 ? '' : 's'}.`);
}
