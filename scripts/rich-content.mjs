import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { parseVisualization } from '../site/scripts/visualization-schema.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const imagePath = /^\.\.\/\.\.\/assets\/essays\/[a-z0-9-]+\/[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp|gif|avif)$/;
export function renderSnippet(source) {
  if (source.length > 20000) throw new Error('Keep each HTML snippet under 20 KB.');
  return `<div class="essay-snippet">${sanitizeHtml(source, {
    allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 's', 'small', 'sub', 'sup', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'div', 'span', 'figure', 'figcaption', 'details', 'summary', 'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img'],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title', 'loading'], th: ['scope'], details: ['open'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    transformTags: {
      img: (tagName, attrs) => ({ tagName, attribs: { src: imagePath.test(attrs.src || '') ? attrs.src : '', alt: attrs.alt || '', loading: 'lazy' } }),
    },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src,
  })}</div>`;
}

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
export const diagramSchema = z.object({
  title: z.string().trim().min(1).max(160),
  nodes: z.array(z.object({ id: identifier, label: z.string().trim().min(1).max(80), column: z.number().int().min(0).max(2).default(0), row: z.number().int().min(0).max(11).optional() }).strict()).min(1).max(12),
  edges: z.array(z.object({ from: identifier, to: identifier, label: z.string().max(60).optional() }).strict()).max(24).default([]),
}).strict().superRefine((diagram, ctx) => {
  const ids = new Set(diagram.nodes.map(n => n.id));
  const positions = new Set(diagram.nodes.map((n, i) => `${n.column}:${n.row ?? i}`));
  if (ids.size !== diagram.nodes.length || positions.size !== diagram.nodes.length) ctx.addIssue({ code: 'custom', message: 'Give each node a unique ID and grid position.' });
  if (diagram.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)) ctx.addIssue({ code: 'custom', message: 'Edges must join two different nodes in this diagram.' });
});
export function parseDiagram(source) {
  try { return diagramSchema.parse(JSON.parse(source)); }
  catch { throw new Error('Invalid diagram. Use a title, 1–12 uniquely named nodes, and edges between those nodes.'); }
}
export function renderDiagram(source) {
  const diagram = parseDiagram(source);
  const nodes = diagram.nodes.map((node, index) => ({ ...node, x: node.column * 260 + 130, y: (node.row ?? index) * 130 + 65 }));
  const width = Math.max(...nodes.map(n => n.x)) + 130, height = Math.max(...nodes.map(n => n.y)) + 65;
  const edges = diagram.edges.map(edge => {
    const from = nodes.find(n => n.id === edge.from), to = nodes.find(n => n.id === edge.to);
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    const offset = Math.min(105 / Math.abs(ux || 1e-10), 38 / Math.abs(uy || 1e-10));
    const x1 = from.x + ux * offset, y1 = from.y + uy * offset, x2 = to.x - ux * offset, y2 = to.y - uy * offset;
    return `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="#b3baa7" stroke-width="2"/><polygon points="${x2},${y2} ${x2 - ux * 10 + uy * 5},${y2 - uy * 10 - ux * 5} ${x2 - ux * 10 - uy * 5},${y2 - uy * 10 + ux * 5}" fill="#e5ad72"/>`;
  }).join('');
  const boxes = nodes.map(node => {
    const lines = node.label.match(/.{1,23}(?:\s|$)|.{1,23}/gu) || [node.label];
    return `<g><rect x="${node.x - 105}" y="${node.y - 38}" width="210" height="76" rx="6" fill="#1a1d17" stroke="#e5ad72"/><text x="${node.x}" y="${node.y - (lines.length - 1) * 9 + 5}" text-anchor="middle" fill="#f0eee5" font-size="16">${lines.map((line, index) => `<tspan x="${node.x}" dy="${index ? 18 : 0}">${escape(line.trim())}</tspan>`).join('')}</text></g>`;
  }).join('');
  const connections = diagram.edges.map(edge => `${nodes.find(n => n.id === edge.from).label} → ${nodes.find(n => n.id === edge.to).label}${edge.label ? `: ${edge.label}` : ''}`);
  return `<figure class="essay-diagram"><figcaption>${escape(diagram.title)}</figcaption><div class="diagram-scroll" role="region" aria-label="${escape(diagram.title)} diagram" tabindex="0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escape(diagram.title)}"><title>${escape(diagram.title)}</title>${edges}${boxes}</svg></div><details><summary>Diagram in words</summary><ul>${(connections.length ? connections : nodes.map(n => n.label)).map(line => `<li>${escape(line)}</li>`).join('')}</ul></details></figure>`;
}

export function richNarration(source) {
  return source.replace(/^(`{3,}|~{3,})(html|diagram|visualization)[^\n]*\n([\s\S]*?)^\1\s*$/gm, (_, fence, kind, body) => {
    if (kind === 'visualization') { try { const spec = parseVisualization(body); return `Visualization: ${spec.title}. ${spec.description}`; } catch { return ''; } }
    if (kind === 'diagram') { try { return `Diagram: ${parseDiagram(body).title}.`; } catch { return ''; } }
    return sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} });
  });
}
