import { mkdir, readFile, readdir, rename, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEssay, serializeEssay, validateEssay, validSlug, hash } from './essays.mjs';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export async function atomicWrite(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

export class StudioStore {
  constructor(root) { this.root = root; this.locks = new Map(); }
  dir(kind, slug = '') { if (slug && !validSlug(slug)) throw fail('Use a lowercase, hyphen-separated filename.'); return join(this.root, kind, slug); }
  async init() { await Promise.all(['drafts', 'essays', 'workbench', 'essay-assets'].map(name => mkdir(this.dir(name), { recursive: true }))); }
  async locked(slug, callback) {
    const previous = this.locks.get(slug) || Promise.resolve();
    const next = previous.catch(() => {}).then(callback); this.locks.set(slug, next);
    try { return await next; } finally { if (this.locks.get(slug) === next) this.locks.delete(slug); }
  }
  path(slug) { this.dir('drafts', slug); return join(this.dir('drafts'), `${slug}.md`); }
  async list() {
    const entries = await readdir(this.dir('drafts'));
    return Promise.all(entries.filter(name => name.endsWith('.md') && validSlug(name.slice(0, -3))).sort().map(async name => {
      const slug = name.slice(0, -3);
      try { const doc = await this.get(slug); return { slug, title: doc.metadata.title || slug, status: doc.metadata.status || 'Draft', published: doc.published }; }
      catch (error) { return { slug, title: slug, error: error.message }; }
    }));
  }
  async get(slug) {
    let source;
    try { source = await readFile(this.path(slug), 'utf8'); } catch (error) { if (error.code === 'ENOENT') throw fail('Essay not found.', 404); throw error; }
    const document = parseEssay(source);
    let commentsSource = '';
    try { commentsSource = await readFile(join(this.dir('workbench', slug), 'comments.md'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let published = false;
    try { await access(join(this.dir('essays'), `${slug}.md`)); published = true; } catch { /* Draft has not been prepared for publication. */ }
    return { ...document, slug, source, revision: hash(source), comments: commentsSource ? parseEssay(commentsSource).metadata.comments || [] : [], commentsRevision: hash(commentsSource), published };
  }
  async create(slug, source, originalSource = source) {
    return this.locked(slug, async () => {
      this.path(slug);
      const doc = parseEssay(source); doc.metadata.draft = true;
      validateEssay(doc);
      try { await writeFile(this.path(slug), serializeEssay(doc), { flag: 'wx' }); }
      catch (error) { if (error.code === 'EEXIST') throw fail('That filename already exists. Choose another name.', 409); throw error; }
      await mkdir(join(this.dir('workbench', slug), 'revisions'), { recursive: true });
      await writeFile(join(this.dir('workbench', slug), 'revisions', 'original.md'), originalSource);
      return this.get(slug);
    });
  }
  checkRevision(current, input) {
    if (input.revision !== current.revision || input.commentsRevision !== current.commentsRevision) throw fail('This essay changed on disk or in another tab. Export your edits, then reload before saving.', 409);
  }
  async save(slug, input) {
    return this.locked(slug, async () => {
      const current = await this.get(slug); this.checkRevision(current, input);
      const doc = { metadata: { ...input.metadata, draft: true }, body: input.body };
      validateEssay(doc);
      const comments = input.comments;
      if (!Array.isArray(comments) || comments.length > 1000) throw fail('Invalid comments.');
      for (const item of comments) {
        if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || !['body', 'summary'].includes(item.field) || typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 10000 || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 10000 || typeof item.resolved !== 'boolean') throw fail('Invalid comment.');
        for (const context of ['before', 'after']) if (item[context] !== undefined && typeof item[context] !== 'string') throw fail('Invalid comment context.');
      }
      const workbench = this.dir('workbench', slug);
      await mkdir(join(workbench, 'revisions'), { recursive: true });
      const source = serializeEssay(doc);
      if (source !== current.source) await writeFile(join(workbench, 'revisions', `${Date.now()}-${current.revision.slice(0, 10)}.md`), current.source);
      const commentsBody = comments.map(item => `## ${item.resolved ? 'Resolved' : 'Open'} · ${item.field}\n\n> ${item.quote.replaceAll('\n', '\n> ')}\n\n${item.text}`).join('\n\n---\n\n');
      await atomicWrite(join(workbench, 'comments.md'), serializeEssay({ metadata: { comments }, body: commentsBody || 'No comments yet.' }));
      await atomicWrite(this.path(slug), source);
      return this.get(slug);
    });
  }
  async history(slug) {
    await this.get(slug);
    const directory = join(this.dir('workbench', slug), 'revisions');
    let files; try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return files.filter(file => file.endsWith('.md')).sort().reverse();
  }
  async revision(slug, name) {
    if (!/^(original|\d+-[a-f0-9]+)\.md$/.test(name)) throw fail('Invalid revision.');
    return readFile(join(this.dir('workbench', slug), 'revisions', name), 'utf8');
  }
  async publish(slug, input) {
    return this.locked(slug, async () => {
      const current = await this.get(slug); this.checkRevision(current, input);
      if (current.comments.some(comment => !comment.resolved)) throw fail('Resolve open comments before preparing a release.');
      validateEssay(current, true);
      const path = join(this.dir('essays'), `${slug}.md`);
      try {
        const previous = await readFile(path, 'utf8');
        const releases = join(this.dir('workbench', slug), 'releases');
        await mkdir(releases, { recursive: true });
        await writeFile(join(releases, `${Date.now()}.md`), previous);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await atomicWrite(path, serializeEssay({ metadata: { ...current.metadata, draft: false, status: 'Final' }, body: current.body }));
      return { path: `content/essays/${slug}.md` };
    });
  }
}
