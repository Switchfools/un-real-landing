import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseVisualization, validateFrame, visualizationExample, limits } from '../site/scripts/visualization-schema.js';
import { createVisualizationVM } from '../runtime/visualization-vm.mjs';
import { renderMarkdown, renderArticle, validateEssay, narrationText } from '../scripts/essays.mjs';

const engine = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }) }));
const input = { width: 640, height: 320, values: { growth: 1 }, pointer: { x: 20, y: 30, down: false }, time: 0, reducedMotion: false };
const evaluate = code => { const vm = createVisualizationVM(engine, code); try { return vm.draw(input); } finally { vm.dispose(); } };

test('interactive definitions render inertly, escape markup and narrate their explanation only', () => {
  const spec = { ...visualizationExample, title: '<script>attack()</script>', code: visualizationExample.code + '\n// </template><img src=x onerror=attack()>' };
  const block = '```visualization\n' + JSON.stringify(spec) + '\n```';
  const rendered = renderMarkdown(block).html;
  assert.match(rendered, /data-viz-spec/); assert.match(rendered, /&lt;\/template&gt;/);
  assert.doesNotMatch(rendered, /<script|<img|<iframe/);
  assert.equal((rendered.match(/<\/template>/g) || []).length, 1);
  assert.match(rendered, /Run visualization/); assert.match(rendered, /static view/);
  const spoken = narrationText({ metadata: {}, body: 'Before.\n\n' + block + '\n\nAfter.' });
  assert.match(spoken, /simplified model/); assert.doesNotMatch(spoken, /function render|commands|onerror/);
  for (const extra of [{ code: 'x'.repeat(limits.code + 1) }, { height: 9000 }, { controls: [{ id: '__proto__', label: 'Bad', type: 'toggle', value: true }] }, { source: 'https://example.com/app.js' }]) assert.throws(() => parseVisualization(JSON.stringify({ ...visualizationExample, ...extra })));
});

test('guest computes interactive drawings with no browser, OS, network, imports or host constructors', () => {
  const vm = createVisualizationVM(engine, visualizationExample.code);
  try {
    const first = vm.draw(input), second = vm.draw({ ...input, values: { growth: 2 } });
    assert.equal(first.caption, 'Growth parameter: 1'); assert.notDeepEqual(first.commands, second.commands);
  } finally { vm.dispose(); }
  const denied = ['window', 'document', 'parent', 'top', 'location', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'postMessage', 'importScripts', 'setTimeout', 'process', 'require', 'Deno', 'WebAssembly'];
  const code = `function render() { const root = ({}).constructor.constructor('return globalThis')(); return {commands:[],caption:JSON.stringify(${JSON.stringify(denied)}.map(name => [name, typeof root[name]]))}; }`;
  assert.deepEqual(JSON.parse(evaluate(code).caption), denied.map(name => [name, 'undefined']));
  assert.throws(() => evaluate('function render() { return fetch("https://example.com/"); }'));
  assert.throws(() => evaluate('import x from "https://example.com/x.js"; function render() { return x; }'));
  assert.throws(() => evaluate('function render() { return {commands:[{type:"html",html:"<img onerror=attack()>"}]}; }'));
});

test('runtime interrupts loops, excessive allocation and stack growth and can recover in a fresh VM', () => {
  const started = performance.now();
  assert.throws(() => evaluate('while(true) {} function render() {}'), /limit/);
  assert.throws(() => evaluate('function render() { while(true) {} }'), /limit/);
  assert.throws(() => evaluate('function render() { return render(); }'), /limit/);
  assert.throws(() => evaluate('function render() { const memory=[]; while(true) memory.push(new Array(100000).fill("data")); }'), /limit/);
  assert.throws(() => evaluate('function render() { return {commands:[],caption:"x".repeat(200000)}; }'), /large/);
  assert.ok(performance.now() - started < 3000);
  assert.equal(evaluate(visualizationExample.code).caption, 'Growth parameter: 1');
});

test('drawing boundary rejects executable attributes, URLs, oversized paths and unbounded coordinates', () => {
  for (const command of [
    { type: 'circle', x: 1, y: 1, r: 10, fill: 'url(https://example.com/)' },
    { type: 'circle', x: Infinity, y: 1, r: 10 },
    { type: 'text', x: 1, y: 1, text: 'Hello', onclick: 'attack()' },
    { type: 'path', d: 'M0 0L1e300 1' },
    { type: 'path', d: '<svg onload=attack()>' },
    { type: 'rect', x: 0, y: 0, width: -10, height: 10 },
    { type: 'image', url: 'https://example.com/pixel' },
  ]) assert.throws(() => validateFrame({ commands: [command] }));
  assert.throws(() => validateFrame({ commands: Array.from({ length: 1201 }, () => ({ type: 'circle', x: 0, y: 0, r: 1 })) }));
  assert.throws(() => validateFrame({ commands: Array.from({ length: 4 }, () => ({ type: 'polyline', points: Array.from({ length: 2000 }, () => [0, 0]) })) }));
});

test('invalid embeds leave drafts reviewable but cannot enter a publication', () => {
  const bad = { ...visualizationExample, fallback: { commands: [{ type: 'path', d: 'M0 0L40 40', stroke: '#bddad1', lineWidth: 94 }] } };
  const block = (kind, value) => '```' + kind + '\n' + value + '\n```';
  const body = 'Before the visual.\n\n' + block('visualization', JSON.stringify(bad)) + '\n\n' + block('diagram', '{}') + '\n\n' + block('html', '<script>attack()</script>' + 'x'.repeat(20001)) + '\n\nAfter the visual.\n\n' + block('visualization', JSON.stringify(visualizationExample));
  const doc = { metadata: { title: 'Review', description: 'Review visuals.', author: 'Test', date: '2026-10-12', action: 'Fix the diagram.', summary: block('visualization', '{bad JSON}') }, body };
  const previewErrors = [], html = renderArticle(doc, { draft: true, previewErrors });
  assert.equal(previewErrors.length, 4);
  assert.match(previewErrors[0], /block 1.*command 1: lineWidth/);
  assert.match(previewErrors[3], /the summary/);
  assert.match(html, /Before the visual/); assert.match(html, /After the visual/);
  assert.equal((html.match(/class="essay-embed-error"/g) || []).length, 4);
  assert.equal((html.match(/data-viz-spec/g) || []).length, 1);
  assert.doesNotMatch(html, /<script|attack\(\)|lineWidth&quot;:94/);
  assert.throws(() => renderArticle(doc), /lineWidth/);
  assert.throws(() => validateEssay({ ...doc, metadata: { ...doc.metadata, summary: 'A readable summary.' } }, true), /lineWidth/);
});
