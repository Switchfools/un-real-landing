import { parseVisualization, validateFrame } from '../site/scripts/visualization-schema.js';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function fallbackSvg(frame, height, title) {
  validateFrame(frame);
  const shapes = frame.commands.map(c => {
    const paint = `fill="${c.fill || (c.type === 'text' ? '#f0eee5' : 'none')}" stroke="${c.stroke || 'none'}" stroke-width="${c.lineWidth ?? 1}" opacity="${c.opacity ?? 1}"`;
    if (c.type === 'line') return `<line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" ${paint}/>`;
    if (c.type === 'rect') return `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" ${paint}/>`;
    if (c.type === 'circle') return `<circle cx="${c.x}" cy="${c.y}" r="${c.r}" ${paint}/>`;
    if (c.type === 'path') return `<path d="${escape(c.d)}" ${paint}/>`;
    if (c.type === 'polyline') return `<polyline points="${c.points.map(p => p.join(',')).join(' ')}" ${paint}/>`;
    return `<text x="${c.x}" y="${c.y}" font-size="${c.size ?? 16}" text-anchor="${{ left: 'start', center: 'middle', right: 'end' }[c.align || 'left']}" ${paint}>${escape(c.text)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 ${height}" width="640" height="${height}" role="img" aria-label="${escape(title)} — static view"><title>${escape(title)}</title>${shapes}</svg>`;
}

export function renderVisualization(source) {
  const spec = parseVisualization(source);
  return `<figure class="essay-visualization" data-visualization>
    <figcaption>${escape(spec.title)}</figcaption><p class="visualization-description">${escape(spec.description)}</p>
    <div data-viz-fallback>${spec.fallback ? fallbackSvg(spec.fallback, spec.height, spec.title) : ''}</div>
    <canvas data-viz-canvas width="640" height="${spec.height}" role="img" aria-label="${escape(spec.title)}" hidden></canvas>
    <p data-viz-caption></p><div class="visualization-controls" data-viz-controls></div>
    <div class="visualization-actions" data-viz-actions hidden><button type="button" data-viz-run>Run visualization</button><button type="button" data-viz-stop disabled>Stop</button><button type="button" data-viz-reset disabled>Reset</button></div>
    <p class="small-note" role="status" data-viz-status>Interactive controls are available with JavaScript. The explanation remains available above.</p>
    <template data-viz-spec>${escape(JSON.stringify(spec))}</template>
  </figure>`;
}
