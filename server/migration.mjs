import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hash, parseEssay, validSlug } from '../scripts/essays.mjs';
import { documentRecord } from './workspace.mjs';
import { mediaTypes } from './media.mjs';
import { requireHuman, requireValue, now } from './errors.mjs';

async function filesUnder(root, relative = '') {
  let entries; try { entries = await readdir(join(root, relative), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'README.md') continue;
    const name = [relative, entry.name].filter(Boolean).join('/');
    requireValue(!entry.isSymbolicLink(), 'Migration does not follow symbolic links.');
    if (entry.isDirectory()) result.push(...await filesUnder(root, name));
    else { const bytes = await readFile(join(root, name)); result.push({ path: name, sha256: hash(bytes), size: bytes.length, content: bytes.toString('base64') }); }
  }
  return result;
}

// Take a byte-for-byte snapshot before touching the private workspace. Original
// Markdown is retained verbatim, including front matter layout and line endings.
export async function snapshotFiles(contentRoot) {
  const files = [];
  for (const directory of ['drafts', 'workbench', 'essays', 'essay-assets']) files.push(...await filesUnder(contentRoot, directory));
  const manifest = files.map(({ path, sha256, size }) => ({ path, sha256, size }));
  return { format: 'essay-studio-files-v1', id: hash(JSON.stringify(manifest)), manifest, files };
}

export async function importFiles(workspace, identity, snapshot, media, backup) {
  requireHuman(identity);
  requireValue(snapshot.format === 'essay-studio-files-v1' && hash(JSON.stringify(snapshot.manifest)) === snapshot.id, 'Invalid migration snapshot.');
  for (const file of snapshot.files) requireValue(hash(Buffer.from(file.content, 'base64')) === file.sha256, 'An import file failed its integrity check.');
  const previous = await workspace.tx(identity, tx => tx.get('migration', snapshot.id, false));
  if (previous) return verifyImport(workspace, identity, snapshot, media);
  requireValue(!(await workspace.list(identity)).length, 'Import requires an empty workspace. Do not overwrite accepted drafts.', 409);
  // A durable backup is mandatory before accepting the import.
  const archive = gzipSync(Buffer.from(JSON.stringify(snapshot)));
  const backupReceipt = await backup(archive, snapshot.id);
  requireValue(backupReceipt?.sha256 === hash(archive), 'Backup verification failed.');
  const records = [], assets = [];
  const lookup = new Map(snapshot.files.map(file => [file.path, file]));
  const text = path => lookup.has(path) ? Buffer.from(lookup.get(path).content, 'base64').toString('utf8') : null;
  for (const file of snapshot.files) {
    if (file.path.startsWith('essay-assets/')) {
      const [, slug, filename, extra] = file.path.split('/');
      requireValue(!extra && validSlug(slug) && /^[a-zA-Z0-9._-]+$/.test(filename) && mediaTypes[extname(filename).toLowerCase()], 'Unsupported media path in migration.');
      const id = `${slug}/${filename}`, bytes = Buffer.from(file.content, 'base64');
      const stored = await media.storage.put({ id, slug, filename, key: `${identity.owner}/${id}`, type: mediaTypes[extname(filename).toLowerCase()], size: file.size, checksum: Buffer.from(file.sha256, 'hex').toString('base64'), state: 'ready', createdAt: now() }, bytes);
      requireValue(hash(await media.storage.read(stored)) === file.sha256, 'Imported media verification failed.');
      assets.push(stored);
      records.push({ kind: 'import-file', id: file.path, data: { ...file, content: undefined, assetId: id } });
    } else records.push({ kind: 'import-file', id: file.path, data: file });
    const draft = file.path.match(/^drafts\/([a-z0-9-]+)\.md$/);
    if (draft) {
      const slug = draft[1], source = text(file.path), commentsSource = text(`workbench/${slug}/comments.md`);
      const comments = commentsSource ? parseEssay(commentsSource).metadata.comments || [] : [];
      const doc = documentRecord(slug, source, comments);
      // Migration alone must not normalize or rewrite the accepted source.
      doc.source = source; doc.revision = `1:${hash(source)}`; doc.published = lookup.has(`essays/${slug}.md`);
      records.push({ kind: 'essay', id: slug, data: doc });
    }
    const revision = file.path.match(/^workbench\/([a-z0-9-]+)\/revisions\/([^/]+\.md)$/);
    if (revision) records.push({ kind: 'revision', id: `${revision[1]}/${revision[2]}`, data: { slug: revision[1], name: revision[2], source: text(file.path), comments: [], reason: 'Imported revision; historical comments were not stored in this format', createdAt: now() } });
    const release = file.path.match(/^workbench\/([a-z0-9-]+)\/releases\/([^/]+\.md)$/);
    if (release) records.push({ kind: 'legacy-release', id: `${release[1]}/${release[2]}`, data: { slug: release[1], name: release[2], source: text(file.path), sha256: file.sha256 } });
    const preview = file.path.match(/^workbench\/([a-z0-9-]+)\/narration-preview\.md$/);
    if (preview) records.push({ kind: 'settings', id: `narration-preview:${preview[1]}`, data: parseEssay(text(file.path)).metadata });
  }
  const result = { id: snapshot.id, fileCount: snapshot.files.length, essayCount: records.filter(r => r.kind === 'essay').length, revisionCount: records.filter(r => r.kind === 'revision').length, mediaCount: assets.length, backup: backupReceipt, createdAt: now() };
  await workspace.tx(identity, async tx => {
    requireValue(!(await tx.list('essay')).length && !await tx.get('migration', snapshot.id, false), 'Workspace changed during import.', 409);
    for (const record of records) await tx.insert(record.kind, record.id, record.data);
    for (const asset of assets) await tx.insert('asset', asset.id, asset);
    await tx.insert('migration', snapshot.id, result);
  });
  return verifyImport(workspace, identity, snapshot, media);
}

export async function verifyImport(workspace, identity, snapshot, media) {
  const result = await workspace.tx(identity, tx => tx.get('migration', snapshot.id));
  const imported = await workspace.tx(identity, tx => tx.list('import-file'));
  requireValue(imported.length === snapshot.files.length, 'Import file count differs.');
  for (const original of snapshot.files) {
    const stored = imported.find(file => file.id === original.path);
    requireValue(stored?.sha256 === original.sha256, 'Import manifest differs.');
    const bytes = stored.assetId ? await media.storage.read(await workspace.tx(identity, tx => tx.get('asset', stored.assetId))) : Buffer.from(stored.content, 'base64');
    requireValue(hash(bytes) === original.sha256, 'Imported bytes differ.');
    const slug = original.path.match(/^drafts\/([a-z0-9-]+)\.md$/)?.[1];
    if (slug) requireValue(hash((await workspace.get(identity, slug)).source) === original.sha256, 'Imported manuscript differs.');
  }
  return { ...result, verified: true };
}

export async function exportOriginalFiles(workspace, identity, media, destination) {
  requireHuman(identity);
  for (const file of await workspace.tx(identity, tx => tx.list('import-file'))) {
    requireValue(/^(drafts|workbench|essays|essay-assets)\//.test(file.id) && !file.id.split('/').some(part => part === '..'), 'Unsafe export path.');
    const bytes = file.assetId ? await media.storage.read(await workspace.tx(identity, tx => tx.get('asset', file.assetId))) : Buffer.from(file.content, 'base64');
    requireValue(hash(bytes) === file.sha256, 'Export failed its integrity check.');
    const path = join(destination, file.id); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  }
}

export async function backupWorkspace(workspace, identity, media) {
  requireHuman(identity);
  const records = await workspace.tx(identity, tx => tx.all());
  const assets = [];
  for (const { data } of records.filter(record => record.kind === 'asset' && record.data.state === 'ready')) {
    const bytes = await media.storage.read(data);
    requireValue(Buffer.from(hash(bytes), 'hex').toString('base64') === data.checksum, 'Backup asset verification failed.');
    assets.push({ id: data.id, content: bytes.toString('base64') });
  }
  return gzipSync(Buffer.from(JSON.stringify({ format: 'essay-studio-backup-v1', owner: identity.owner, createdAt: now(), records, assets })));
}

export async function restoreWorkspace(workspace, identity, media, archive) {
  requireHuman(identity); const backup = JSON.parse(gunzipSync(archive));
  requireValue(backup.format === 'essay-studio-backup-v1' && backup.owner === identity.owner, 'Backup belongs to a different workspace.');
  requireValue(!(await workspace.tx(identity, tx => tx.all())).length, 'Restore requires an empty database. Use revision history to restore individual manuscripts.', 409);
  for (const saved of backup.assets) {
    const record = backup.records.find(item => item.kind === 'asset' && item.id === saved.id), bytes = Buffer.from(saved.content, 'base64');
    requireValue(record && Buffer.from(hash(bytes), 'hex').toString('base64') === record.data.checksum, 'Backup asset is corrupt.');
    record.data = await media.storage.put(record.data, bytes);
  }
  const restoredAssets = new Map(backup.records.filter(record => record.kind === 'asset').map(record => [record.id, record.data]));
  for (const record of backup.records.filter(record => ['release-preview', 'release-snapshot'].includes(record.kind))) {
    record.data.assets = record.data.assets.map(asset => {
      const restored = restoredAssets.get(asset.id);
      requireValue(restored?.checksum === asset.checksum, 'A frozen release asset is missing from the backup.');
      return { ...asset, key: restored.key, versionId: restored.versionId };
    });
  }
  await workspace.tx(identity, async tx => {
    requireValue(!(await tx.all()).length, 'Workspace changed during restoration.', 409);
    for (const record of backup.records) {
      // Restoring a snapshot must not resume side effects or reactivate old OAuth grants.
      if (record.kind === 'grant') record.data = { ...record.data, revoked: true };
      if (record.kind === 'job' && ['running', 'queued'].includes(record.data.state)) record.data = { ...record.data, state: record.data.providerPending ? 'uncertain' : 'failed', error: 'Restored from backup. Explicitly review and retry this job.' };
      if (record.kind === 'release' && record.data.state === 'preparing') record.data = { ...record.data, state: 'failed', error: 'Restored from backup. Check GitHub before retrying.' };
      await tx.insert(record.kind, record.id, record.data);
    }
  });
  return { records: backup.records.length, assets: backup.assets.length };
}
