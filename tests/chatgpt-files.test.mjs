import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { downloadChatgptImage, publicAddress, imageFileLimit } from '../server/chatgpt-files.mjs';

const file = { file_id: 'file-generated-image', download_url: 'https://files.example.com/generated.png?signature=private' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZfoAAAAASUVORK5CYII=', 'base64');
const resolver = async () => [{ address: '8.8.8.8', family: 4 }];
function transport(responses, inspect = () => {}) {
  return (url, options, callback) => {
    inspect(url, options);
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const value = responses.shift(); assert.ok(value, 'unexpected network request');
      const response = Readable.from(value.chunks || [png]);
      Object.assign(response, { statusCode: 200, headers: { 'content-type': 'image/png' } }, value);
      callback(response);
    });
    return req;
  };
}

test('ChatGPT file downloads pin DNS, preserve signed links and send no account credentials', async () => {
  const visits = []; let resolutions = 0;
  const bytes = await downloadChatgptImage(file, {
    resolver: async () => { resolutions++; return resolver(); },
    requester: transport([{ statusCode: 302, headers: { location: '/image.png?signature=second-private' } }, {}], (url, options) => {
      visits.push(url.href); assert.equal(options.agent, false); assert.equal(options.method, 'GET');
      assert.equal(options.autoSelectFamily, false); assert.equal(options.family, 4);
      assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Encoding']);
      options.lookup(url.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
      options.lookup(url.hostname, { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]); });
    }),
  });
  assert.deepEqual(bytes, png); assert.equal(resolutions, 2);
  assert.deepEqual(visits, [file.download_url, 'https://files.example.com/image.png?signature=second-private']);
});

test('file downloads reject private/reserved networks, ambiguous DNS and unsafe redirects', async () => {
  const blocked = ['0.0.0.0', '10.0.0.1', '100.100.100.200', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2002:7f00:1::1', '2001::1'];
  for (const address of blocked) assert.equal(publicAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(publicAddress(address), true, address);
  let requests = 0; const requester = () => { requests++; throw new Error('must not connect'); };
  for (const url of ['http://files.example.com/image.png', 'file:///etc/passwd', 'sandbox:/mnt/data/image.png', 'https://user:password@files.example.com/image.png', 'https://files.example.com:444/image.png', 'https://127.0.0.1/image.png', 'https://2130706433/image.png', 'https://[::ffff:127.0.0.1]/image.png']) {
    await assert.rejects(downloadChatgptImage({ ...file, download_url: url }, { resolver, requester }));
  }
  await assert.rejects(downloadChatgptImage(file, { resolver: async () => [...await resolver(), { address: '10.0.0.1', family: 4 }], requester }), /private or reserved/);
  assert.equal(requests, 0);
  let hops = 0;
  await assert.rejects(downloadChatgptImage(file, { resolver, requester: transport([{ statusCode: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }], () => hops++) }), /private or reserved/);
  assert.equal(hops, 1);
  let lookups = 0;
  await assert.rejects(downloadChatgptImage(file, { resolver: async () => ++lookups === 1 ? resolver() : [{ address: '127.0.0.1', family: 4 }], requester: transport([{ statusCode: 302, headers: { location: '/next' } }]) }), /private or reserved/);
  await assert.rejects(downloadChatgptImage(file, { resolver, requester: transport(Array.from({ length: 4 }, () => ({ statusCode: 302, headers: { location: '/loop' } }))) }), /too many/);
});

test('file downloads bound bytes, type and time and redact errors and signed URLs', async () => {
  for (const response of [
    { headers: { 'content-type': 'image/svg+xml' } },
    { headers: { 'content-type': 'text/html' } },
    { headers: { 'content-type': 'image/png', 'content-length': String(imageFileLimit + 1) } },
    { headers: { 'content-type': 'image/png', 'content-length': '10000' } },
    { headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' } },
    { chunks: [] },
    { chunks: [Buffer.alloc(imageFileLimit), Buffer.alloc(1)] },
    { statusCode: 403 },
  ]) {
    await assert.rejects(downloadChatgptImage(file, { resolver, requester: transport([response]) }), error => { assert.doesNotMatch(error.message, /signature|private|example\.com/); return true; });
  }
  await assert.rejects(downloadChatgptImage({ ...file, mime_type: 'text/html' }, { resolver, requester: () => assert.fail('no network') }), /Select a/);
  await assert.rejects(downloadChatgptImage(file, { resolver: async () => { throw new Error(file.download_url); } }), error => !error.message.includes('signature'));
  await assert.rejects(downloadChatgptImage(file, { timeoutMs: 10, resolver: () => new Promise(() => {}), requester: () => assert.fail('no request after deadline') }), /fresh file reference/);
  await assert.rejects(downloadChatgptImage(file, { resolver, timeoutMs: 10, requester: (_url, options) => {
    const req = new EventEmitter(); req.end = () => options.signal.addEventListener('abort', () => req.emit('error', new Error(file.download_url)), { once: true }); return req;
  } }), /fresh file reference/);
});
