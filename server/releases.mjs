import { randomUUID } from 'node:crypto';
import { hash, serializeEssay, validateEssay, renderArticle } from '../scripts/essays.mjs';
import { referencedAssets } from './media.mjs';
import { diff, checkRevision } from './workspace.mjs';
import { requireHuman, requireValue, now, fail } from './errors.mjs';

export class Releases {
  constructor(workspace, github, media, jobs) { Object.assign(this, { workspace, github, media, jobs }); }
  async prepare(identity, slug, input) {
    requireHuman(identity);
    const doc = await this.workspace.get(identity, slug); checkRevision(doc, input);
    try { validateEssay(doc, true); } catch (error) { throw fail(error.message); }
    requireValue(!doc.comments.some(item => !item.resolved), 'Resolve open comments before preparing a release.');
    const baseCommit = await this.github.head(), beforeSource = await this.github.source(slug, baseCommit);
    const source = serializeEssay({ metadata: { ...doc.metadata, draft: false, status: 'Final' }, body: doc.body });
    const files = referencedAssets(source, slug);
    return this.workspace.tx(identity, async tx => {
      checkRevision(await tx.get('essay', slug), input);
      const assets = [];
      for (const filename of files) { const asset = await tx.get('asset', `${slug}/${filename}`); requireValue(asset.state === 'ready', 'Complete all media uploads before publishing.'); assets.push(asset); }
      const id = randomUUID();
      const release = { id, slug, title: doc.metadata.title, source, beforeSource, assets, baseCommit, revision: doc.revision, commentsRevision: doc.commentsRevision, createdAt: now() };
      release.reviewHash = hash(JSON.stringify(release));
      await tx.insert('release-preview', id, release);
      return { ...release, assets: assets.map(({ filename, size, checksum }) => ({ filename, size, checksum })), diff: diff(beforeSource, source), html: renderArticle({ ...doc, metadata: { ...doc.metadata, draft: false } }) };
    });
  }
  confirm(identity, id, input) {
    requireHuman(identity);
    return this.workspace.tx(identity, tx => this.workspace.receipt(tx, `publish:${id}`, input, async () => {
      const release = await tx.get('release-preview', id);
      requireValue(release.reviewHash === input.reviewHash, 'Review the exact release before publishing.', 409);
      checkRevision(await tx.get('essay', release.slug), release);
      requireValue(!await tx.get('release-snapshot', id, false), 'This release was already confirmed.', 409);
      const frozen = { ...release, confirmedAt: now(), actor: identity.owner };
      await tx.insert('release-snapshot', id, frozen);
      await tx.insert('release', id, { id, slug: release.slug, state: 'preparing', createdAt: now() });
      await this.jobs.insert(tx, 'publish', { releaseId: id }, id);
      return { id, state: 'preparing' };
    }));
  }
  async get(identity, id) {
    requireHuman(identity);
    const release = await this.workspace.tx(identity, tx => tx.get('release', id));
    if (release.commitSha && (['committed', 'deploying'].includes(release.state) || release.state === 'failed' && release.committedAt)) {
      const status = await this.github.deployment(release.commitSha);
      return this.workspace.tx(identity, async tx => {
        const latest = await tx.get('release', id);
        if (!['committed', 'deploying', 'failed'].includes(latest.state)) return latest;
        const updated = { ...latest, error: null, ...status }; await tx.put('release', id, updated); return updated;
      });
    }
    return release;
  }
  list(identity) { requireHuman(identity); return this.workspace.tx(identity, tx => tx.list('release')); }
  async publishJob(identity, input) {
    const frozen = await this.workspace.tx(identity, tx => tx.get('release-snapshot', input.releaseId));
    let release = await this.workspace.tx(identity, tx => tx.get('release', input.releaseId));
    if (['committed', 'deploying', 'live'].includes(release.state)) return release;
    if (!release.commitSha) {
      const assets = [];
      for (const asset of frozen.assets) {
        const bytes = await this.media.storage.read(asset);
        requireValue(Buffer.from(hash(bytes), 'hex').toString('base64') === asset.checksum, 'A release asset failed its integrity check.');
        assets.push({ filename: asset.filename, bytes });
      }
      const commitSha = await this.github.prepareCommit(frozen, assets);
      release = { ...release, commitSha };
      await this.workspace.tx(identity, tx => tx.put('release', release.id, release));
    }
    await this.github.advance({ ...frozen, commitSha: release.commitSha });
    return this.workspace.tx(identity, async tx => {
      const updated = { ...release, state: 'committed', committedAt: now() }; await tx.put('release', release.id, updated);
      const doc = await tx.get('essay', frozen.slug); await tx.put('essay', frozen.slug, { ...doc, published: true }); return updated;
    });
  }
}
