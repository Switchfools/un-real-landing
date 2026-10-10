import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { escape } from './essays.mjs';

// This subprocess receives FONTCONFIG_FILE without changing the build's environment.
const asset = path => fileURLToPath(new URL(`../site/assets/${path}`, import.meta.url));
async function label(value, size, width, height, color = '#f0eee5') {
  const input = await sharp({ text: { text: `<span foreground="${color}">${escape(value)}</span>`,
    font: `Inter ${size}`, fontfile: asset('fonts/Inter-Regular.woff2'), width, wrap: 'word-char', rgba: true,
  } }).png().toBuffer();
  return sharp(input).resize({ width, height, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
const essay = JSON.parse(input);
const background = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#111310"/><path d="M64 532H1136" stroke="#45493c"/><path d="M64 151H112" stroke="#e5ad72" stroke-width="3"/></svg>');
const logo = await sharp(asset('brand/lockup.svg')).resize({ width: 175 }).png().toBuffer();
const domain = await label('un-real.ai', 20, 180, 30, '#b3baa7');
const title = await label(essay.title, 64, 1020, 250);
const author = await label(essay.author, 23, 960, 36, '#e5ad72');
const footer = await label('AI alignment. Human agency. Ideas into action.', 20, 1040, 36, '#b3baa7');
const card = await sharp(background).composite([
  { input: logo, left: 64, top: 54 }, { input: domain, left: 1040, top: 68 }, { input: title, left: 64, top: 184 },
  { input: author, left: 64, top: 467 }, { input: footer, left: 64, top: 558 },
]).png().toBuffer();
process.stdout.write(card);
