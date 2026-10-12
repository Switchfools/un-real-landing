export const limits = Object.freeze({ source: 60000, code: 24000, output: 180000, commands: 1200, points: 12000, controls: 8, memory: 16 * 1024 * 1024, executionMs: 40 });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const number = (value, min = -10000, max = 10000) => Number.isFinite(value) && value >= min && value <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => check(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported visualization property.');
const color = value => value === undefined || /^(?:#[\da-f]{3}|#[\da-f]{6}|#[\da-f]{8}|transparent)$/i.test(value);

export function validateFrame(frame) {
  keys(frame, ['commands', 'caption']);
  check(Array.isArray(frame.commands) && frame.commands.length <= limits.commands, 'Use at most 1,200 drawing commands.');
  check(frame.caption === undefined || (typeof frame.caption === 'string' && frame.caption.length <= 1000), 'Keep the visualization caption under 1,000 characters.');
  let points = 0;
  for (const [index, c] of frame.commands.entries()) {
    check(object(c), 'Invalid drawing command.');
    const fields = { line: ['x1', 'y1', 'x2', 'y2'], rect: ['x', 'y', 'width', 'height'], circle: ['x', 'y', 'r'], path: ['d'], polyline: ['points'], text: ['x', 'y', 'text', 'size', 'align'] }[c.type];
    check(fields, 'Supported drawings: line, rect, circle, path, polyline and text.');
    keys(c, ['type', 'fill', 'stroke', 'lineWidth', 'opacity', ...fields]);
    check(color(c.fill) && color(c.stroke), `Drawing command ${index + 1}: use hex colors or transparent.`);
    check(c.lineWidth === undefined || number(c.lineWidth, 0, 20), `Drawing command ${index + 1}: lineWidth must be between 0 and 20. Use filled shapes for wider areas.`);
    check(c.opacity === undefined || number(c.opacity, 0, 1), `Drawing command ${index + 1}: opacity must be between 0 and 1.`);
    for (const name of fields.filter(key => !['d', 'points', 'text', 'size', 'align'].includes(key))) check(number(c[name]), 'Drawing coordinates must be finite and bounded.');
    if (c.type === 'circle') check(c.r >= 0 && c.r <= 2000, 'Invalid circle radius.');
    if (c.type === 'rect') check(c.width >= 0 && c.height >= 0, 'Invalid rectangle size.');
    if (c.type === 'text') check(text(c.text, 300) && (c.size === undefined || number(c.size, 8, 64)) && (c.align === undefined || ['left', 'center', 'right'].includes(c.align)), 'Invalid drawing label.');
    if (c.type === 'path') {
      check(text(c.d, 12000) && /^[MmLlHhVvCcSsQqTtAaZz\d.,+\-\seE]+$/.test(c.d), 'Paths must contain SVG coordinates only.');
      const coordinates = c.d.match(/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g) || [];
      check(coordinates.every(value => number(Number(value))), 'Path coordinates must be bounded.'); points += coordinates.length;
    }
    if (c.type === 'polyline') {
      check(Array.isArray(c.points) && c.points.length <= 4000 && c.points.every(p => Array.isArray(p) && p.length === 2 && p.every(v => number(v))), 'Invalid polyline points.');
      points += c.points.length * 2;
    }
  }
  check(points <= limits.points && JSON.stringify(frame).length <= limits.output, 'The drawing is too complex. Reduce the number of points.');
  return frame;
}

export function parseVisualization(source) {
  check(typeof source === 'string' && source.length <= limits.source, 'Keep each visualization under 60 KB.');
  let spec; try { spec = JSON.parse(source); } catch { throw new Error('A visualization block must contain valid JSON.'); }
  keys(spec, ['title', 'description', 'height', 'animated', 'controls', 'code', 'fallback']);
  check(text(spec.title, 160) && text(spec.description, 2000), 'Give the visualization a title and a useful text explanation.');
  check(text(spec.code, limits.code), 'Provide a render(input) function under 24 KB.');
  spec.height ??= 400; spec.animated ??= false; spec.controls ??= [];
  check(Number.isInteger(spec.height) && number(spec.height, 200, 640) && typeof spec.animated === 'boolean', 'Use a height from 200 to 640 and a boolean animated flag.');
  check(Array.isArray(spec.controls) && spec.controls.length <= limits.controls, 'Use at most eight controls.');
  const ids = new Set();
  for (const control of spec.controls) {
    keys(control, ['id', 'label', 'type', 'min', 'max', 'step', 'value', 'options']);
    check(typeof control.id === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(control.id) && !['__proto__', 'constructor', 'prototype'].includes(control.id) && !ids.has(control.id) && text(control.label, 80), 'Give each control a unique ID and accessible label.'); ids.add(control.id);
    if (control.type === 'range') {
      check(number(control.min) && number(control.max) && control.max > control.min && number(control.step, 0.0001, control.max - control.min) && number(control.value, control.min, control.max) && !control.options, 'Invalid range control.');
    } else if (control.type === 'select') {
      check(Array.isArray(control.options) && control.options.length >= 2 && control.options.length <= 12 && control.options.every(option => text(option, 80)) && new Set(control.options).size === control.options.length && control.options.includes(control.value), 'Invalid selection control.');
    } else if (control.type === 'toggle') check(typeof control.value === 'boolean', 'Toggle controls need a boolean value.');
    else throw new Error('Supported controls: range, select and toggle.');
  }
  if (spec.fallback) validateFrame(spec.fallback);
  return spec;
}

export const visualizationExample = {
  title: 'Small choices, different paths',
  description: 'Move the growth slider to compare two illustrative paths. This is a simplified model, not a prediction about society.',
  height: 320,
  controls: [{ id: 'growth', label: 'Growth', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 }],
  code: 'function render({width, height, values}) { const points = []; for (let i = 0; i <= 80; i++) { const x = i / 80; points.push([30 + x * (width - 60), height - 30 - Math.pow(x, values.growth) * (height - 60)]); } return {commands:[{type:"line",x1:30,y1:height-30,x2:width-30,y2:height-30,stroke:"#888888"},{type:"polyline",points,stroke:"#e5ad72",lineWidth:3}],caption:"Growth parameter: " + values.growth}; }',
  fallback: { commands: [{ type: 'polyline', points: [[30, 290], [180, 225], [360, 145], [610, 30]], stroke: '#e5ad72', lineWidth: 3 }] },
};
