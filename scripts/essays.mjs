import { createHash } from 'node:crypto';
import { Marked } from 'marked';
import { parse, stringify } from 'yaml';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const validSlug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length < 100;
export const wordCount = value => String(value || '').trim().split(/\s+/).filter(Boolean).length;
export const displayDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))
  ? new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : 'Date to be decided';

export function parseEssay(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Start with YAML front matter between --- lines.');
  const metadata = parse(match[1], { maxAliasCount: 20 });
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid front matter.');
  return { metadata, body: match[2].trim() };
}

export function serializeEssay({ metadata, body }) {
  return `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

export function validateEssay({ metadata, body }, publishing = false) {
  if (typeof body !== 'string' || body.length > 500_000) throw new Error('Essay body must be text, under 500 KB.');
  for (const field of ['title', 'description', 'date', 'author', 'action', 'summary', 'subtitle']) {
    if (metadata[field] !== undefined && typeof metadata[field] !== 'string') throw new Error(`${field} must be text.`);
  }
  if (metadata.draft !== undefined && typeof metadata.draft !== 'boolean') throw new Error('draft must be true or false.');
  if (publishing) {
    for (const field of ['title', 'description', 'date', 'author', 'action', 'summary']) {
      if (!metadata[field]?.trim()) throw new Error(`Provide a nonempty ${field}.`);
    }
    const date = new Date(`${metadata.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== metadata.date) throw new Error('date must be a valid YYYY-MM-DD date.');
    if (!body.trim()) throw new Error('The essay body is empty.');
    if (wordCount(metadata.summary) > 180) throw new Error('Keep the opening summary at 180 words or fewer.');
  }
  if (metadata.audio !== undefined) {
    const audio = metadata.audio;
    if (!audio || !Array.isArray(audio.tracks) || !audio.tracks.length || audio.tracks.length > 100) throw new Error('Audio needs at least one track.');
    if (typeof audio.narrator !== 'string' || !audio.narrator.trim() || typeof audio.ai_generated !== 'boolean') throw new Error('Audio needs a narrator and an ai_generated flag.');
    for (const track of audio.tracks) {
      if (typeof track.title !== 'string' || !/^\.\.\/\.\.\/assets\/essays\/[a-z0-9-]+\/[a-zA-Z0-9._-]+\.(mp3|m4a|wav|ogg)$/.test(track.src)) throw new Error('Use a local essay audio file.');
    }
    if (publishing && audio.source_hash !== narrationHash({ metadata, body })) throw new Error('Narration is out of date. Regenerate it, attach a current recording, or remove audio before publishing.');
  }
}

function safeUrl(value, image = false) {
  const url = String(value || '').trim();
  if (!url || /[\u0000-\u0020\\]/.test(url) || url.startsWith('//')) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !(image ? /^https?:/i : /^(https?:|mailto:)/i).test(url)) return '';
  return escape(url);
}

export function renderMarkdown(source, prefix = '') {
  const headings = [], ids = new Map(), notes = new Map(), references = new Map();
  const markdown = new Marked({ gfm: true, async: false });
  markdown.use({
    extensions: [{
      name: 'footnoteDefinition', level: 'block',
      start: src => src.indexOf('[^'),
      tokenizer(src) {
        const match = /^\[\^([\w-]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]{2,}[^\n]*|(?=\n[ \t]{2,})))*)(?:\n|$)/.exec(src);
        if (!match) return;
        notes.set(match[1], match[2].replace(/\n {2,}/g, '\n').trim());
        return { type: 'footnoteDefinition', raw: match[0] };
      }, renderer() { return ''; },
    }, {
      name: 'footnoteReference', level: 'inline', start: src => src.indexOf('[^'),
      tokenizer(src) { const match = /^\[\^([\w-]+)\]/.exec(src); if (match) return { type: 'footnoteReference', raw: match[0], id: match[1] }; },
      renderer(token) {
        if (!notes.has(token.id)) return escape(token.raw);
        const count = (references.get(token.id) || 0) + 1; references.set(token.id, count);
        return `<sup id="${prefix}ref-${escape(token.id)}-${count}"><a href="#${prefix}note-${escape(token.id)}" aria-label="Footnote ${escape(token.id)}">${escape(token.id)}</a></sup>`;
      },
    }],
    renderer: {
      html({ text }) { return escape(text); },
      heading({ tokens, depth }) {
        const label = tokens.map(token => token.text || token.raw || '').join('').replace(/<[^>]*>/g, '');
        const base = label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-') || 'section';
        const number = (ids.get(base) || 0) + 1; ids.set(base, number);
        const id = `${prefix}${base}${number > 1 ? `-${number}` : ''}`;
        headings.push({ id, label, depth });
        return `<h${Math.max(2, depth)} id="${id}">${this.parser.parseInline(tokens)}</h${Math.max(2, depth)}>\n`;
      },
      link({ href, title, tokens }) {
        const url = safeUrl(href), label = this.parser.parseInline(tokens);
        return url ? `<a href="${url}"${title ? ` title="${escape(title)}"` : ''}>${label}</a>` : label;
      },
      image({ href, title, text }) {
        const url = safeUrl(href, true);
        return url ? `<img src="${url}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ''} loading="lazy">` : escape(text);
      },
    },
  });
  let html = markdown.parse(source || '');
  if (notes.size) html += `<section class="footnotes" aria-label="Footnotes"><ol>${[...notes].map(([id, text]) => `<li id="${prefix}note-${escape(id)}">${markdown.parse(text)}${references.has(id) ? `<a href="#${prefix}ref-${escape(id)}-1" aria-label="Back to reference ${escape(id)}">↩</a>` : ''}</li>`).join('')}</ol></section>`;
  return { html, headings };
}

export function narrationText({ metadata, body }) {
  // Read links as prose, skip URLs and footnote definitions, and retain pauses.
  return `${metadata.title || ''}.\n\n${metadata.subtitle || metadata.description || ''}\n\nThe idea in brief.\n\n${metadata.summary || ''}\n\nThe full essay.\n\n${body}`
    .replace(/^\[\^[\w-]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[\^[\w-]+\]/g, '')
    .replace(/<[^>]*>/g, '').replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/gm, '').replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/[*_`]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
export const narrationHash = essay => hash(narrationText(essay));

export function audioPlayer(audio) {
  if (!audio?.tracks?.length) return '';
  return `<section class="essay-audio" data-audio-player aria-label="Listen to this essay">
    <div class="audio-heading"><span class="audio-symbol" aria-hidden="true">◖))</span><div><h2>Listen to this essay</h2><p>${escape(audio.narrator)}${audio.ai_generated ? ' · AI narration' : ' · Recorded narration'}</p></div></div>
    <audio controls preload="metadata" src="${escape(audio.tracks[0].src)}">Your browser does not support audio. Download the recording below.</audio>
    <div class="audio-options"><label>Speed <select data-audio-speed><option value="0.8">0.8×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
    ${audio.tracks.length > 1 ? `<label>Part <select data-audio-track>${audio.tracks.map((track, index) => `<option value="${escape(track.src)}">${index + 1}. ${escape(track.title)}</option>`).join('')}</select></label>` : ''}
    <a data-audio-download href="${escape(audio.tracks[0].src)}" download>Download audio ↓</a></div>
    ${audio.tracks.length > 1 ? `<noscript><ol>${audio.tracks.map(track => `<li><a href="${escape(track.src)}">${escape(track.title)}</a></li>`).join('')}</ol></noscript>` : ''}
  </section>`;
}

export function renderArticle({ metadata, body }, { draft = false } = {}) {
  const rendered = renderMarkdown(body);
  const toc = rendered.headings.filter(heading => heading.depth <= 2);
  const minutes = Math.max(1, Math.ceil(wordCount(body) / 220));
  const seconds = Math.max(15, Math.ceil(wordCount(metadata.summary) / 220 * 60 / 5) * 5);
  return `<article class="essay-page" aria-labelledby="essay-title">
    <header class="essay-header"><p class="eyebrow">Essays &amp; convictions${draft ? ' <span>Working draft</span>' : ''}</p>
    <h1 id="essay-title">${escape(metadata.title || 'Untitled essay')}</h1>
    <p class="essay-deck">${escape(metadata.subtitle || metadata.description || '')}</p>
    <p class="essay-byline"><span>${escape(metadata.author || 'Author to be added')}</span><time${/^\d{4}-\d{2}-\d{2}$/.test(metadata.date) ? ` datetime="${escape(metadata.date)}"` : ''}>${displayDate(metadata.date)}</time><span>${minutes} min read</span></p></header>
    <section class="essay-abstract" aria-labelledby="abstract-title"><div class="abstract-label"><h2 id="abstract-title">The idea in brief</h2><span>${seconds < 60 ? `${seconds} sec` : `${Math.ceil(seconds / 60)} min`} read</span></div>
    <div class="essay-prose" data-comment-field="summary">${renderMarkdown(metadata.summary || '*Start with the conclusion. Give a busy reader the whole idea.*', 'brief-').html}</div>
    <a class="text-link" href="#full-essay">Read the full essay <span aria-hidden="true">↓</span></a></section>
    ${audioPlayer(metadata.audio)}
    <div class="essay-divider" id="full-essay"><span>The full essay</span><span>${minutes} min · Make room for the reasoning</span></div>
    <div class="essay-reading-grid">${toc.length ? `<aside class="essay-outline"><details open><summary>In this essay</summary><nav aria-label="Essay sections">${toc.map(heading => `<a href="#${heading.id}">${escape(heading.label)}</a>`).join('')}</nav></details></aside>` : ''}
    <div><div class="essay-prose essay-body" data-comment-field="body">${rendered.html}</div>
    ${metadata.action ? `<section class="essay-action" aria-labelledby="action-title"><p class="eyebrow">Make the idea count</p><h2 id="action-title">From belief to action</h2><p>${escape(metadata.action)}</p><a class="text-link" href="mailto:contact-us@un-real.ai">Put this idea to work together <span aria-hidden="true">↗</span></a></section>` : ''}</div></div>
  </article>`;
}
