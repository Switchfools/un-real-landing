import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Rasterize our native SVG/CSS brand artwork for crawlers and browser icons.
// No network requests or image-generation service are involved.
const directory = new URL('../site/assets/brand/', import.meta.url);
const data = async (url, type) => `data:${type};base64,${(await readFile(url)).toString('base64')}`;
const attractor = await data(new URL('attractor.svg', directory), 'image/svg+xml');
const favicon = await data(new URL('favicon.svg', directory), 'image/svg+xml');
const lockup = await data(new URL('lockup.svg', directory), 'image/svg+xml');
const font = await data(new URL('../site/assets/fonts/Inter-Regular.woff2', import.meta.url), 'font/woff2');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url('${font}'); }
    * { box-sizing: border-box; } body { margin: 0; background: #111310; color: #f0eee5; font-family: Inter; }
    main { width: 1200px; height: 630px; padding: 58px 64px; position: relative; }
    .brand { width: 172px; height: 45px; } .art { position: absolute; width: 595px; height: 500px; top: 65px; right: -12px; }
    .eyebrow { margin-top: 65px; color: #c5cbbb; font: 11px monospace; letter-spacing: 2px; }
    h1 { position: relative; margin: 23px 0 0; font-size: 66px; line-height: 1.08; font-weight: 400; letter-spacing: -3.7px; }
    em { font-style: normal; color: #e5ad72; } footer { position: absolute; bottom: 42px; left: 64px; right: 64px; border-top: 1px solid #ffffff26; padding-top: 23px; display: flex; justify-content: space-between; color: #b3baa7; font: 11px monospace; }
  </style></head><body><main><img class="brand" src="${lockup}" alt=""><img class="art" src="${attractor}" alt=""><p class="eyebrow">INTELLIGENCE. WITH INTENTION.</p><h1>The future of AI<br>is not<br><em>predetermined.</em></h1><footer><span>Alignment. Coexistence. Symbiosis.</span><span>un-real.ai</span></footer></main></body></html>`);
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map(image => image.decode())]));
  await page.screenshot({ path: fileURLToPath(new URL('social-preview.png', directory)) });
  for (const [size, name] of [[32, 'favicon.png'], [180, 'apple-touch-icon.png']]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:#111310"><img style="display:block;width:100%;height:100vh" src="${favicon}"></body></html>`);
    await page.evaluate(() => document.images[0].decode());
    await page.screenshot({ path: fileURLToPath(new URL(name, directory)) });
  }
  console.log('Rendered social preview and PNG icons.');
} finally { await browser.close(); }
