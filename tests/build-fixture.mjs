import { resolve } from 'node:path';
import { buildSite } from '../scripts/build.mjs';

// Use the same native Node module loader as deployment. Playwright's ESM loader
// cannot synchronously link the sanitizer's CJS-to-ESM parser dependency.
await buildSite({ contentDir: resolve('tests/fixtures/essays'), outDir: process.argv[2] });
