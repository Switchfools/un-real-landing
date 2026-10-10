import { mkdir, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { escape } from './essays.mjs';

// Keep the image renderer's fonts isolated from browsers and other child processes.
const asset = path => fileURLToPath(new URL(`../site/assets/${path}`, import.meta.url));
const cache = fileURLToPath(new URL('../.local/font-cache/', import.meta.url));
let configReady;

export async function socialCard(essay) {
  const env = { ...process.env };
  if (!env.FONTCONFIG_FILE) {
    configReady ||= (async () => {
      await mkdir(cache, { recursive: true });
      const config = `${cache}fonts.conf`, temporary = `${config}.${process.pid}`;
      await writeFile(temporary, `<?xml version="1.0"?><fontconfig><dir>${escape(asset('fonts'))}</dir><cachedir>${escape(cache)}</cachedir></fontconfig>`);
      await rename(temporary, config);
      return config;
    })();
    env.FONTCONFIG_FILE = await configReady;
  }
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [fileURLToPath(new URL('./social-card-renderer.mjs', import.meta.url))],
      { env, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 30000 },
      (error, png) => error ? reject(error) : resolve(png));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ title: essay.title, author: essay.author }));
  });
}
