import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { hash, validSlug, parseEssay, renderArticle } from '../scripts/essays.mjs';
import { requireValue, requireHuman, now } from './errors.mjs';

export const mediaTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
export function referencedAssets(source, slug) {
  const files = new Set();
  for (const match of source.matchAll(/\.\.\/\.\.\/assets\/essays\/([a-z0-9-]+)\/([a-zA-Z0-9._-]+)/g)) {
    requireValue(match[1] === slug && mediaTypes[extname(match[2]).toLowerCase()] && !match[2].includes('..'), 'Use media uploaded to this essay.'); files.add(match[2]);
  }
  // Do not publish external tracking images or allow malformed private-media references.
  for (const match of renderArticle(parseEssay(source)).matchAll(/<img\s[^>]*src="([^"]+)"/g)) requireValue(new RegExp(`^\\.\\./\\.\\./assets/essays/${slug}/[a-zA-Z0-9._-]+$`).test(match[1]), 'Upload images to this essay before publishing.');
  return [...files].sort();
}

export class S3Media {
  constructor(bucket, origin, client = new S3Client({})) { this.bucket = bucket; this.origin = origin; this.client = client; }
  async uploadTicket(asset) {
    return createPresignedPost(this.client, { Bucket: this.bucket, Key: asset.key, Expires: 600,
      Fields: { 'Content-Type': asset.type, 'x-amz-checksum-sha256': asset.checksum },
      Conditions: [['content-length-range', asset.size, asset.size], ['eq', '$Content-Type', asset.type], ['eq', '$x-amz-checksum-sha256', asset.checksum]] });
  }
  async head(asset) {
    const data = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: asset.key, ChecksumMode: 'ENABLED' }));
    return { size: data.ContentLength, type: data.ContentType, checksum: data.ChecksumSHA256, versionId: data.VersionId };
  }
  async download(asset) { return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: asset.key, VersionId: asset.versionId }), { expiresIn: 900 }); }
  async read(asset) { return Buffer.from(await (await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: asset.key, VersionId: asset.versionId }))).Body.transformToByteArray()); }
  async put(asset, bytes) {
    const data = await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: asset.key, Body: bytes, ContentType: asset.type, ChecksumSHA256: asset.checksum }));
    return { ...asset, versionId: data.VersionId };
  }
}

export class MediaService {
  constructor(workspace, storage) { this.workspace = workspace; this.storage = storage; }
  async ticket(identity, slug, input) {
    requireHuman(identity); await this.workspace.get(identity, slug);
    const extension = extname(input.name || '').toLowerCase(), type = mediaTypes[extension];
    requireValue(type && Number.isSafeInteger(input.size) && input.size > 0 && input.size <= (type.startsWith('image/') ? 12_000_000 : 60_000_000), 'Upload a supported image under 12 MB or recording under 60 MB.');
    requireValue(typeof input.checksum === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(input.checksum), 'Provide the file’s SHA-256 checksum.');
    const filename = `${randomUUID()}${extension}`, id = `${slug}/${filename}`;
    const asset = { id, slug, filename, key: `${identity.owner}/${id}`, type, size: input.size, checksum: input.checksum, state: 'pending', createdAt: now() };
    await this.workspace.tx(identity, tx => tx.insert('asset', id, asset));
    return { id, ...(await this.storage.uploadTicket(asset)) };
  }
  async complete(identity, id) {
    requireHuman(identity); const asset = await this.workspace.tx(identity, tx => tx.get('asset', id));
    if (asset.state === 'ready') return this.result(asset);
    const actual = await this.storage.head(asset);
    requireValue(actual.size === asset.size && actual.type === asset.type && actual.checksum === asset.checksum, 'The uploaded file did not match its declared contents.');
    return this.workspace.tx(identity, async tx => {
      const current = await tx.get('asset', id);
      if (current.state === 'ready') return this.result(current);
      await tx.put('asset', id, { ...asset, ...actual, state: 'ready' }); return this.result(asset);
    });
  }
  result(asset) { return { id: asset.id, src: `../../assets/essays/${asset.id}`, kind: asset.type.startsWith('image/') ? 'image' : 'audio' }; }
  async urls(identity, html) {
    html = html.replace(/<img\s[^>]*src="([^"]+)"[^>]*>/g, (tag, src) => /^\.\.\/\.\.\/assets\/essays\/[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(src) ? tag : '<span class="small-note">Upload this image to the essay to include it in the preview.</span>');
    const ids = [...new Set([...html.matchAll(/(?:\.\.\/\.\.\/|\/)assets\/essays\/([a-z0-9-]+\/[a-zA-Z0-9._-]+)/g)].map(match => match[1]))];
    for (const id of ids) {
      const asset = await this.workspace.tx(identity, tx => tx.get('asset', id)); requireValue(asset.state === 'ready', 'An asset upload is incomplete.');
      const url = (await this.storage.download(asset)).replaceAll('&', '&amp;');
      html = html.replaceAll(`../../assets/essays/${id}`, url).replaceAll(`/assets/essays/${id}`, url);
    }
    return html;
  }
  async storeGenerated(identity, slug, filename, bytes, type = 'audio/mpeg') {
    requireValue(validSlug(slug) && /^[a-zA-Z0-9._-]+$/.test(filename), 'Invalid media name.');
    const id = `${slug}/${filename}`, existing = await this.workspace.tx(identity, tx => tx.get('asset', id, false));
    if (existing?.state === 'ready') return existing;
    const asset = { id, slug, filename, key: `${identity.owner}/${id}`, size: bytes.length, type, checksum: Buffer.from(hash(bytes), 'hex').toString('base64'), state: 'ready', createdAt: now() };
    const stored = await this.storage.put(asset, bytes);
    await this.workspace.tx(identity, tx => tx.put('asset', id, stored)); return stored;
  }
}
