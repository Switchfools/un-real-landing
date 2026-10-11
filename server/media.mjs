import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { imageSize } from 'image-size';
import { hash, validSlug, parseEssay, renderArticle } from '../scripts/essays.mjs';
import { requireValue, requireHuman, now } from './errors.mjs';
import { chatgptFile, downloadChatgptImage, imageFileLimit } from './chatgpt-files.mjs';

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
  constructor(workspace, storage, { fileDownload = downloadChatgptImage } = {}) { this.workspace = workspace; this.storage = storage; this.fileDownload = fileDownload; }
  async listImages(identity, slug) {
    requireValue(identity.permissions?.includes('read'), 'This connection needs read permission.', 403);
    return this.workspace.tx(identity, async tx => (await tx.list('asset')).filter(asset => asset.slug === slug && asset.state === 'ready' && asset.type.startsWith('image/')).map(asset => ({ ...this.result(asset), size: asset.size, alt: asset.alt || '' })));
  }
  imageInput(identity, input) {
    requireValue(identity.permissions?.includes('propose'), 'This connection needs propose permission.', 403);
    requireValue(validSlug(input.slug) && typeof input.alt === 'string' && input.alt.trim() && input.alt.length <= 500, 'Supply an essay filename and useful image alt text.');
  }
  async imageTarget(tx, slug) {
    const essay = await tx.get('essay', slug, false);
    requireValue(essay || (await tx.list('proposal')).some(item => item.slug === slug && item.state === 'pending'), 'Create an essay proposal or read an existing essay before staging its images.', 404);
  }
  async stageImage(identity, input) {
    this.imageInput(identity, input);
    requireValue(typeof input.data === 'string' && input.data.length <= 2_800_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(input.data), 'Supply a base64 PNG, JPEG, WebP, GIF or AVIF under 2 MB.');
    const bytes = Buffer.from(input.data, 'base64');
    requireValue(bytes.length > 0 && bytes.length <= 2_000_000 && bytes.toString('base64') === input.data, 'Supply canonical base64 for an image under 2 MB.');
    return this.workspace.tx(identity, tx => this.workspace.receipt(tx, 'stage-image', { ...input, data: hash(bytes) }, async () => {
      await this.imageTarget(tx, input.slug);
      return this.storeStagedImage(tx, identity, input, bytes);
    }));
  }
  async stageChatgptImage(identity, input) {
    this.imageInput(identity, input); const file = chatgptFile.parse(input.file);
    // Signed URLs expire and may refresh for the same file. The receipt freezes the
    // first successful copy by file ID, without persisting its bearer URL or name.
    const receipt = { requestId: input.requestId, slug: input.slug, alt: input.alt, fileId: file.file_id };
    return this.workspace.tx(identity, tx => this.workspace.receipt(tx, 'stage-chatgpt-image', receipt, async () => {
      await this.imageTarget(tx, input.slug);
      const bytes = await this.fileDownload(file);
      requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= imageFileLimit, 'Use an image under 12 MB.');
      return this.storeStagedImage(tx, identity, input, bytes);
    }));
  }
  async storeStagedImage(tx, identity, input, bytes) {
    let dimensions; try { dimensions = imageSize(bytes); } catch { /* Report unsupported bytes without exposing internals. */ }
    const extension = { png: '.png', jpg: '.jpg', webp: '.webp', gif: '.gif', avif: '.avif' }[dimensions?.type];
    requireValue(extension && dimensions.width > 0 && dimensions.height > 0 && dimensions.width <= 10000 && dimensions.height <= 10000 && dimensions.width * dimensions.height <= 25_000_000, 'Use a raster image no larger than 25 megapixels; SVG and HTML uploads are not accepted.');
    const filename = `image-${hash(bytes)}${extension}`, id = `${input.slug}/${filename}`;
    let asset = await tx.get('asset', id, false);
    if (!asset) {
      requireValue((await tx.list('asset')).filter(item => item.slug === input.slug && item.stagedByMcp).length < 100, 'This essay already has 100 staged images. Reuse an existing image.');
      asset = await this.storage.put({ id, slug: input.slug, filename, key: `${identity.owner}/${id}`, type: mediaTypes[extension], size: bytes.length, checksum: Buffer.from(hash(bytes), 'hex').toString('base64'), alt: input.alt.trim(), stagedByMcp: true, state: 'ready', createdAt: now() }, bytes);
      await tx.insert('asset', id, asset);
    }
    const alt = input.alt.trim().replace(/[\\\[\]\r\n]/g, ' ');
    return { ...this.result(asset), markdown: `![${alt}](${this.result(asset).src})`, summary: 'Image staged privately. Include this Markdown in a proposal for the author to review; the manuscript is unchanged.' };
  }
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
