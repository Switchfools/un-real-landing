import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { diffLines } from 'diff';
import { hash, parseEssay, serializeEssay, validateEssay, validSlug, renderArticle } from '../scripts/essays.mjs';
import { requireHuman, requireValue, fail, now } from './errors.mjs';

const uuid = z.string().uuid();
const comment = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), field: z.enum(['body', 'summary']),
  quote: z.string().trim().min(1).max(10000), text: z.string().trim().min(1).max(10000), resolved: z.boolean(),
  before: z.string().max(10000).optional(), after: z.string().max(10000).optional(),
  origin: z.enum(['source', 'preview']).optional(), created: z.string().optional(),
}).strict();
export const proposalInput = z.object({
  requestId: uuid, slug: z.string().refine(validSlug, 'Use a lowercase, hyphen-separated filename.'),
  baseRevision: z.string().nullable(), commentsRevision: z.string().nullable(),
  source: z.string().max(600000), summary: z.string().trim().min(1).max(4000),
  resolveCommentIds: z.array(z.string()).max(1000).default([]),
}).strict();
export const proposalRevisionInput = proposalInput.extend({ proposalId: uuid, expectedVersion: z.number().int().positive() });
export const snapshot = doc => ({ source: doc.source, revision: doc.revision, comments: doc.comments, commentsRevision: doc.commentsRevision });

export function manuscript(source) {
  try {
    const parsed = parseEssay(source); parsed.metadata.draft = true; validateEssay(parsed);
    return { ...parsed, source: serializeEssay(parsed) };
  } catch (error) { throw fail(error.message); }
}
export function documentRecord(slug, source, comments = [], previous = null) {
  const doc = manuscript(source), version = (previous?.version || 0) + 1;
  const checkedComments = z.array(comment).max(1000).parse(comments);
  requireValue(new Set(checkedComments.map(item => item.id)).size === checkedComments.length, 'Comment IDs must be unique.');
  return { ...doc, slug, version, revision: `${version}:${hash(doc.source)}`, comments: checkedComments,
    commentsRevision: `${version}:${hash(JSON.stringify(checkedComments))}`, published: previous?.published || false, updatedAt: now() };
}
export function checkRevision(current, input) {
  requireValue(current.revision === input.revision && current.commentsRevision === input.commentsRevision,
    'This essay or its comments changed. Reload and review the current version before continuing.', 409);
}
export function diff(before, after) {
  return diffLines(before, after, { timeout: 1000, maxEditLength: 20000 })?.map(part => ({ text: part.value, kind: part.added ? 'added' : part.removed ? 'removed' : 'context' }))
    || [{ kind: 'removed', text: before }, { kind: 'added', text: after }];
}

export class Workspace {
  constructor(db, { origin = 'http://127.0.0.1:4312' } = {}) { this.db = db; this.origin = origin; }
  tx(identity, action) { requireValue(identity?.owner, 'Sign in to continue.', 401); return this.db.transaction(identity.owner, action); }
  async receipt(tx, operation, input, action) {
    uuid.parse(input.requestId); const fingerprint = hash(JSON.stringify({ operation, input }));
    const previous = await tx.get('receipt', input.requestId, false);
    if (previous) { requireValue(previous.fingerprint === fingerprint, 'This request ID was already used for a different operation.', 409); return previous.result; }
    const result = await action(); await tx.insert('receipt', input.requestId, { fingerprint, result, createdAt: now() }); return result;
  }
  list(identity) { return this.tx(identity, async tx => (await tx.list('essay')).map(({ slug, metadata, published }) => ({ slug, title: metadata.title || slug, status: metadata.status || 'Draft', published }))); }
  get(identity, slug) { requireValue(validSlug(slug), 'Invalid essay filename.'); return this.tx(identity, tx => tx.get('essay', slug)); }
  create(identity, slug, source, originalSource = source) {
    requireHuman(identity); requireValue(validSlug(slug), 'Invalid essay filename.');
    return this.tx(identity, async tx => {
      requireValue(!await tx.get('essay', slug, false), 'That filename already exists.', 409);
      const doc = documentRecord(slug, source);
      await tx.insert('essay', slug, doc); await tx.insert('revision', `${slug}/original.md`, { slug, name: 'original.md', source: originalSource, comments: [], createdAt: now(), reason: 'Original import' });
      return doc;
    });
  }
  async saveRecord(tx, current, source, comments, reason) {
    const name = `${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 12)}.md`;
    await tx.insert('revision', `${current.slug}/${name}`, { ...snapshot(current), slug: current.slug, name, createdAt: now(), reason });
    const doc = documentRecord(current.slug, source, comments, current); await tx.put('essay', current.slug, doc); return doc;
  }
  save(identity, slug, input) {
    requireHuman(identity);
    return this.tx(identity, async tx => {
      const current = await tx.get('essay', slug); checkRevision(current, input);
      return this.saveRecord(tx, current, serializeEssay({ metadata: input.metadata, body: input.body }), input.comments, 'Author edit');
    });
  }
  history(identity, slug) { return this.tx(identity, async tx => { await tx.get('essay', slug); return (await tx.list('revision')).filter(item => item.slug === slug).map(item => item.name).sort().reverse(); }); }
  revision(identity, slug, name) { return this.tx(identity, tx => tx.get('revision', `${slug}/${name}`)); }
  proposals(identity, slug) { return this.tx(identity, async tx => (await tx.list('proposal')).filter(item => !slug || item.slug === slug).reverse()); }
  async proposalView(tx, id, version) {
    const proposal = await tx.get('proposal', id), change = await tx.get('proposal-version', `${id}/${version || proposal.version}`);
    const current = await tx.get('essay', proposal.slug, false);
    const stale = (current?.revision ?? null) !== change.baseRevision || (current?.commentsRevision ?? null) !== change.commentsRevision || proposal.version !== change.version;
    const beforeMetadata = change.baseSource ? parseEssay(change.baseSource).metadata : {}, afterMetadata = parseEssay(change.source).metadata;
    const metadataChanges = [...new Set([...Object.keys(beforeMetadata), ...Object.keys(afterMetadata)])].filter(key => !isDeepStrictEqual(beforeMetadata[key], afterMetadata[key])).map(key => ({ field: key, before: beforeMetadata[key] ?? null, after: afterMetadata[key] ?? null }));
    return { ...proposal, ...change, currentVersion: proposal.version, stale, diff: diff(change.baseSource, change.source), html: renderArticle(parseEssay(change.source), { draft: true }),
      metadataChanges, resolvedComments: change.baseComments.filter(item => change.resolveCommentIds.includes(item.id)), reviewUrl: `${this.origin}/?proposal=${id}&version=${change.version}` };
  }
  proposal(identity, id, version) { uuid.parse(id); return this.tx(identity, tx => this.proposalView(tx, id, version)); }
  propose(identity, raw, revising = false) {
    const input = (revising ? proposalRevisionInput : proposalInput).parse(raw);
    return this.tx(identity, tx => this.receipt(tx, revising ? 'revise-proposal' : 'propose', input, async () => {
      const current = await tx.get('essay', input.slug, false);
      requireValue((current?.revision ?? null) === input.baseRevision && (current?.commentsRevision ?? null) === input.commentsRevision, 'Read the current manuscript and comments before proposing changes.', 409);
      let proposal = { id: randomUUID(), slug: input.slug, version: 0, state: 'pending', createdAt: now() };
      if (revising) {
        proposal = await tx.get('proposal', input.proposalId);
        requireValue(proposal.state === 'pending' && proposal.version === input.expectedVersion && proposal.slug === input.slug, 'The proposal changed or is no longer pending.', 409);
      }
      const doc = manuscript(input.source);
      // The AI edits writing, not media, approval state, or publication flags.
      requireValue(isDeepStrictEqual(doc.metadata.audio ?? null, current?.metadata.audio ?? null), 'Audio attachments can only be changed in the Studio.');
      doc.metadata.status = current?.metadata.status || 'Draft';
      const source = serializeEssay(doc);
      const comments = current?.comments || [];
      requireValue(new Set(input.resolveCommentIds).size === input.resolveCommentIds.length && input.resolveCommentIds.every(id => comments.some(item => item.id === id && !item.resolved)), 'Only current open comments can be proposed for resolution.');
      const version = proposal.version + 1;
      await tx.insert('proposal-version', `${proposal.id}/${version}`, { ...input, source, id: proposal.id, version, baseSource: current?.source || '', baseComments: comments, createdAt: now(), actor: identity.clientId || 'author' });
      await tx.put('proposal', proposal.id, { ...proposal, version, summary: input.summary, updatedAt: now() });
      return { id: proposal.id, version, summary: input.summary, state: 'pending', reviewUrl: `${this.origin}/?proposal=${proposal.id}&version=${version}` };
    }));
  }
  decide(identity, id, input, accepted) {
    requireHuman(identity); uuid.parse(id); z.object({ requestId: uuid, version: z.number().int().positive() }).strict().parse(input);
    return this.tx(identity, tx => this.receipt(tx, `${accepted ? 'approve' : 'reject'}:${id}`, input, async () => {
      const proposal = await tx.get('proposal', id);
      requireValue(proposal.state === 'pending' && proposal.version === input.version, 'This proposal changed or was already reviewed. Reopen the diff.', 409);
      const change = await tx.get('proposal-version', `${id}/${input.version}`);
      let document = null;
      if (accepted) {
        const current = await tx.get('essay', proposal.slug, false);
        requireValue((current?.revision ?? null) === change.baseRevision && (current?.commentsRevision ?? null) === change.commentsRevision, 'The manuscript or comments changed after this proposal. Ask for a refreshed proposal.', 409);
        const comments = (current?.comments || []).map(item => change.resolveCommentIds.includes(item.id) ? { ...item, resolved: true } : item);
        if (current) document = await this.saveRecord(tx, current, change.source, comments, `Accepted proposal ${id}/${input.version}`);
        else {
          document = documentRecord(proposal.slug, change.source, comments);
          await tx.insert('essay', proposal.slug, document);
          await tx.insert('revision', `${proposal.slug}/original.md`, { slug: proposal.slug, name: 'original.md', source: change.source, comments, createdAt: now(), reason: 'Approved new essay' });
        }
      }
      const state = accepted ? 'accepted' : 'rejected';
      await tx.put('proposal', id, { ...proposal, state, decidedAt: now() });
      await tx.insert('approval', `${id}/${input.version}`, { id, version: input.version, state, actor: identity.owner, createdAt: now(), revision: document?.revision });
      return { state, document };
    }));
  }
}
