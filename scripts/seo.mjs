import { escape } from './essays.mjs';

export const SITE_URL = 'https://un-real.ai/';
export const HOME_TITLE = 'AI alignment & human–AI symbiosis — un-real.ai';
export const HOME_DESCRIPTION = 'Building a flourishing future with AI through alignment, human agency, and symbiosis. Explore our mission, practical work, and essays that lead to action.';
export const ESSAYS_TITLE = 'Essays on AI alignment & human–AI symbiosis';
export const ESSAYS_DESCRIPTION = 'Ideas about AI alignment, human agency, and a flourishing future. Read the reasoning, question the assumptions, and turn each essay into a concrete action.';
export const absolute = (path, base = SITE_URL) => new URL(path, base).href;
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

export function organization(base) {
  return { '@type': 'Organization', '@id': `${base}#organization`, name: 'un-real.ai', url: base,
    description: HOME_DESCRIPTION, email: 'contact-us@un-real.ai',
    logo: { '@type': 'ImageObject', url: absolute('assets/brand/apple-touch-icon.png', base), width: 180, height: 180 } };
}

export function siteSchema(base, essays = [], collection = false) {
  const url = collection ? absolute('essays/', base) : base;
  return { '@context': 'https://schema.org', '@graph': [organization(base),
    { '@type': 'WebSite', '@id': `${base}#website`, name: 'un-real.ai', url: base, inLanguage: 'en', publisher: { '@id': `${base}#organization` } },
    { '@type': collection ? 'CollectionPage' : 'WebPage', '@id': `${url}#page`, url,
      name: collection ? ESSAYS_TITLE : HOME_TITLE, description: collection ? ESSAYS_DESCRIPTION : HOME_DESCRIPTION,
      isPartOf: { '@id': `${base}#website` }, inLanguage: 'en',
      about: ['AI alignment', 'Human agency', 'Human–AI symbiosis'].map(name => ({ '@type': 'Thing', name })),
      ...(collection ? { mainEntity: { '@type': 'ItemList', itemListElement: essays.map((essay, index) => ({ '@type': 'ListItem', position: index + 1, name: essay.title, url: absolute(`essays/${essay.slug}/`, base) })) } } : {}),
    },
  ] };
}

export function articleSchema(essay, base) {
  const url = absolute(`essays/${essay.slug}/`, base);
  return { '@context': 'https://schema.org', '@graph': [organization(base),
    { '@type': 'BlogPosting', '@id': `${url}#article`, url, mainEntityOfPage: url, headline: essay.title,
      description: essay.description, image: absolute(essay.socialImage, base), datePublished: essay.date,
      author: { '@type': 'Person', name: essay.author }, publisher: { '@id': `${base}#organization` },
      inLanguage: 'en', isAccessibleForFree: true, wordCount: essay.words },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'un-real.ai', item: base },
      { '@type': 'ListItem', position: 2, name: 'Essays', item: absolute('essays/', base) },
      { '@type': 'ListItem', position: 3, name: essay.title, item: url },
    ] },
  ] };
}

export function metadata({ base, title, description, path = '', image = 'assets/brand/social-preview.png', imageAlt = 'un-real.ai — Alignment. Coexistence. Symbiosis.', article, schema, noindex = false }) {
  const url = absolute(path, base), picture = absolute(image, base);
  return `<title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
  <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
  <link rel="canonical" href="${escape(url)}">
  <link rel="alternate" type="application/rss+xml" title="un-real.ai essays" href="${escape(absolute('feed.xml', base))}">
  <meta property="og:type" content="${article ? 'article' : 'website'}">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="un-real.ai">
  <meta property="og:title" content="${escape(article?.title || title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${escape(url)}">
  <meta property="og:image" content="${escape(picture)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escape(imageAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(article?.title || title)}">
  <meta name="twitter:description" content="${escape(description)}">
  <meta name="twitter:image" content="${escape(picture)}">
  <meta name="twitter:image:alt" content="${escape(imageAlt)}">
  ${article ? `<meta name="author" content="${escape(article.author)}"><meta property="article:published_time" content="${article.date}">` : ''}
  ${schema ? `<script type="application/ld+json">${json(schema)}</script>` : ''}`;
}

export function sitemap(essays, base) {
  // No invented lastmod dates: a deployment is not an editorial update.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['', 'essays/', ...essays.map(e => `essays/${e.slug}/`)].map(path => `<url><loc>${escape(absolute(path, base))}</loc></url>`).join('')}</urlset>\n`;
}

export function feed(essays, base) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>un-real.ai — Essays &amp; convictions</title><link>${escape(absolute('essays/', base))}</link><description>${escape(ESSAYS_DESCRIPTION)}</description><language>en</language><atom:link href="${escape(absolute('feed.xml', base))}" rel="self" type="application/rss+xml"/>${essays.map(e => `<item><title>${escape(e.title)}</title><link>${escape(absolute(`essays/${e.slug}/`, base))}</link><guid isPermaLink="true">${escape(absolute(`essays/${e.slug}/`, base))}</guid><pubDate>${new Date(`${e.date}T00:00:00Z`).toUTCString()}</pubDate><description>${escape(e.description + '\n\nFrom belief to action: ' + e.action)}</description></item>`).join('')}</channel></rss>\n`;
}
