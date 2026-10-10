import { mkdir, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const output = resolve('.build/studio');
await rm(output, { recursive: true, force: true });
await cp('studio', output, { recursive: true });
await mkdir(`${output}/assets`, { recursive: true });
await cp('site/assets/brand', `${output}/assets/brand`, { recursive: true });
await cp('site/assets/fonts', `${output}/assets/fonts`, { recursive: true });
await cp('site/styles', `${output}/styles`, { recursive: true });
await mkdir(`${output}/scripts`, { recursive: true });
await cp('site/scripts/essay.js', `${output}/scripts/essay.js`);
await build({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: process.cwd() }, outfile: `${output}/vendor/supabase.js`, bundle: true, format: 'esm', platform: 'browser', minify: true, target: 'es2022' });
await build({ entryPoints: ['server/lambda.mjs', 'server/worker.mjs'], outdir: '.build/server', bundle: true, platform: 'node', format: 'esm', target: 'node24', outExtension: { '.js': '.mjs' }, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
console.log('Built private Studio and server artifacts in .build/.');
