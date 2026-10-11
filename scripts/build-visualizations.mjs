import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildVisualizations(output) {
  await mkdir(join(output, 'scripts'), { recursive: true });
  const result = await build({ absWorkingDir: root, entryPoints: ['runtime/visualization-worker.mjs'], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', minify: true, loader: { '.wasm': 'binary' }, conditions: ['browser'] });
  await writeFile(join(output, 'scripts/visualization-worker.js'), result.outputFiles[0].contents);
  for (const file of ['visualizations.js', 'visualization-schema.js']) await cp(join(root, 'site/scripts', file), join(output, 'scripts', file));
  await mkdir(join(output, 'assets/licenses'), { recursive: true });
  const license = await readFile(join(root, 'node_modules/@jitl/quickjs-wasmfile-release-sync/LICENSE'));
  await writeFile(join(output, 'assets/licenses/quickjs.txt'), license);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildVisualizations(resolve('.build/visualizations'));
