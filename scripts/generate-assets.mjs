import { readFile, writeFile } from 'node:fs/promises';
import { ARTBOARD, createParticles, project } from '../site/scripts/lorenz.js';

const particles = createParticles();
const colors = ['#95603b', '#b87542', '#d89350', '#edb875', '#ffe0ad'];
const layers = colors.map(() => []);
for (let i = 0; i < particles.length; i += 3) {
  const [x, y] = project(particles[i], particles[i + 1]);
  const layer = Math.min(4, Math.max(0, Math.floor((particles[i + 2] - 5) / 9)));
  layers[layer].push(`M${x.toFixed(2)} ${y.toFixed(2)}h.01`);
}
const dots = layers.map((paths, i) => `<path d="${paths.join('')}" stroke="${colors[i]}" opacity="${(0.45 + i * 0.12).toFixed(2)}" stroke-width="${2 * (0.75 + i * 0.13)}"/>`).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ARTBOARD.width} ${ARTBOARD.height}" fill="none" stroke-linecap="round">\n${dots}\n</svg>\n`;
const iconPath = [];
const state = createParticles(500);
for (let i = 0; i < state.length; i += 3) {
  const [x, y] = project(state[i], state[i + 1]);
  iconPath.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
}
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 620"><rect width="620" height="620" rx="110" fill="#111310"/><path transform="translate(0 50)" d="${iconPath.join('')}" fill="none" stroke="#e5ad72" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;

for (const [name, content] of [['attractor.svg', svg], ['favicon.svg', favicon]]) {
  const url = new URL(`../site/assets/brand/${name}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if (await readFile(url, 'utf8') !== content) throw new Error(`${name} is stale; run npm run assets`);
  } else {
    await writeFile(url, content);
  }
}
console.log(process.argv.includes('--check') ? 'Static projection matches the simulation.' : 'Generated attractor and favicon SVGs.');
