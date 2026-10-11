import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { fail, requireValue } from './errors.mjs';

// OpenAI requires all four properties in the schema, with only these two required.
// https://developers.openai.com/plugins/reference#define-file-inputs
export const chatgptFile = z.object({
  download_url: z.string().min(1).max(8192),
  file_id: z.string().min(1).max(512),
  mime_type: z.string().max(200).optional(),
  file_name: z.string().max(512).optional(),
}).strict();
export const imageFileLimit = 12_000_000;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'application/octet-stream']);
const downloadError = () => fail('Could not read the ChatGPT image file. Select or attach the image again to provide a fresh file reference.');

export function publicAddress(address) {
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  // Reject private, reserved, mapped and transition addresses, including metadata services.
  return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3));
}

function fileUrl(value) {
  let url; try { url = new URL(value); } catch { throw downloadError(); }
  requireValue(url.protocol === 'https:' && (!url.port || url.port === '443') && !url.username && !url.password && !url.hash, 'Use the temporary HTTPS file reference supplied by ChatGPT.');
  return url;
}

async function abortable(promise, signal) {
  signal.throwIfAborted();
  let cancel;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      cancel = () => reject(downloadError()); signal.addEventListener('abort', cancel, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', cancel); }
}

function readFileResponse(url, address, signal, requester) {
  return new Promise((resolve, reject) => {
    const req = requester(url, {
      method: 'GET', agent: false, signal, maxHeaderSize: 16384,
      family: address.family, autoSelectFamily: false,
      // Pin the checked DNS result. A second resolution could rebind to a private address.
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      headers: { Accept: 'image/png, image/jpeg, image/webp, image/gif, image/avif, application/octet-stream', 'Accept-Encoding': 'identity' },
    }, async response => {
      try {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          requireValue(typeof response.headers.location === 'string', 'The image file redirect is invalid.');
          resolve({ redirect: new URL(response.headers.location, url).href }); return;
        }
        requireValue(response.statusCode === 200, 'The ChatGPT image link is unavailable or expired. Select or attach the image again.');
        const type = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        requireValue(imageTypes.has(type), 'The file must be a PNG, JPEG, WebP, GIF or AVIF image.');
        requireValue(!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity', 'Compressed file transfers are not supported.');
        const length = response.headers['content-length'];
        requireValue(length === undefined || (/^\d+$/.test(length) && Number(length) > 0 && Number(length) <= imageFileLimit), 'Use an image under 12 MB.');
        let size = 0; const chunks = [];
        for await (const chunk of response) {
          size += chunk.length; requireValue(size <= imageFileLimit, 'Use an image under 12 MB.'); chunks.push(chunk);
        }
        requireValue(size > 0 && (length === undefined || size === Number(length)), 'The image download was incomplete. Select or attach the image again.');
        resolve(Buffer.concat(chunks));
      } catch (error) { reject(error); }
      finally { response.destroy(); }
    });
    req.on('error', () => reject(downloadError()));
    req.end();
  });
}

// This consumes a temporary file capability, not an OpenAI API key. Do not log,
// persist, echo, or forward the signed URL, response headers, or network errors.
export async function downloadChatgptImage(file, { resolver = lookup, requester = request, timeoutMs = 15000 } = {}) {
  chatgptFile.parse(file);
  requireValue(!file.mime_type || imageTypes.has(file.mime_type.toLowerCase()), 'Select a PNG, JPEG, WebP, GIF or AVIF image.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = fileUrl(file.download_url);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await abortable(resolver(hostname, { all: true, verbatim: true }), controller.signal);
      controller.signal.throwIfAborted();
      requireValue(addresses.length && addresses.every(item => publicAddress(item.address)), 'The image file must be hosted outside private or reserved networks.');
      const address = addresses.find(item => item.family === 4) || addresses[0];
      const result = await readFileResponse(url, address, controller.signal, requester);
      if (Buffer.isBuffer(result)) return result;
      url = fileUrl(result.redirect);
    }
    throw fail('The image file redirected too many times. Select or attach it again.');
  } catch (error) { throw error.status ? error : downloadError(); }
  finally { clearTimeout(timer); }
}
