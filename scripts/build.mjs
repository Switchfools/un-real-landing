import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { parse as parseYaml } from 'yaml';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const markdown = new Marked({ gfm: true, async: false,
  walkTokens(token) { if (token.type === 'heading') token.depth = Math.max(2, token.depth); },
});
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const displayDate = date => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

async function readEssays(directory) {
  const essays = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('_') || entry.name === 'README.md') continue;
    const source = await readFile(join(directory, entry.name), 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (!match) throw new Error(`${entry.name}: start with YAML front matter between --- lines.`);
    const metadata = parseYaml(match[1]);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error(`${entry.name}: invalid front matter.`);
    if (metadata.draft === true) continue;
    if (metadata.draft !== undefined && metadata.draft !== false) throw new Error(`${entry.name}: draft must be true or false.`);
    for (const field of ['title', 'description', 'date', 'author', 'action']) {
      if (typeof metadata[field] !== 'string' || !metadata[field].trim()) throw new Error(`${entry.name}: provide a nonempty ${field}.`);
    }
    const date = new Date(`${metadata.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== metadata.date) {
      throw new Error(`${entry.name}: date must be a valid YYYY-MM-DD date.`);
    }
    const slug = entry.name.slice(0, -3);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`${entry.name}: use a lowercase, hyphen-separated filename.`);
    if (!match[2].trim()) throw new Error(`${entry.name}: the essay body is empty.`);
    essays.push({ ...metadata, slug, html: markdown.parse(match[2]), minutes: Math.max(1, Math.ceil(match[2].trim().split(/\s+/).length / 220)) });
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
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${header}
  <main id="main" class="shell">
    <article class="essay-page" aria-labelledby="essay-title">
      <a class="essay-back" href="../../#essays">← All essays</a>
      <header class="essay-header">
        <p class="eyebrow">Essays &amp; convictions</p>
        <h1 id="essay-title">${escape(essay.title)}</h1>
        <p class="essay-deck">${escape(essay.description)}</p>
        <p class="essay-byline"><span>${escape(essay.author)}</span><time datetime="${essay.date}">${displayDate(essay.date)}</time><span>${essay.minutes} min read</span></p>
      </header>
      <div class="essay-prose">${essay.html}</div>
      <section class="essay-action" aria-labelledby="action-title">
        <p class="eyebrow">Make the idea count</p>
        <h2 id="action-title">From belief to action</h2>
        <p>${escape(essay.action)}</p>
        <a class="text-link" href="mailto:contact-us@un-real.ai">Put this idea to work together <span aria-hidden="true">↗</span></a>
      </section>
    </article>
  </main>
  ${footer}
</body>
</html>
`;
}

export async function buildSite({ contentDir = join(projectRoot, 'content/essays'), outDir = join(projectRoot, 'dist') } = {}) {
  // Parse and validate before touching output. Only the generated tree is replaced.
  const essays = await readEssays(contentDir);
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
  if (essays.length) {
    await writeFile(join(output, 'index.html'), home.replace(/<!-- essays:start -->[\s\S]*?<!-- essays:end -->/, `<!-- essays:start -->\n        ${essayList(essays)}\n        <!-- essays:end -->`));
  }
  for (const essay of essays) {
    const directory = join(output, 'essays', essay.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), essayPage(essay, home));
  }
  return essays.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await buildSite();
  console.log(`Built dist/ with ${count} published essay${count === 1 ? '' : 's'}.`);
}
