import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';

// Both local preview URLs serve precisely the deployable tree.
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const prefix = '/un-real-landing/';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };

createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/un-real-landing') {
      response.writeHead(301, { Location: prefix }); response.end(); return;
    }
    if (path.startsWith(prefix)) path = path.slice(prefix.length);
    else path = path.slice(1);
    if (!path || path.endsWith('/')) path += 'index.html';
    const target = resolve(root, path);
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    const data = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Preview: http://127.0.0.1:${port}/ (also /un-real-landing/)`);
});
