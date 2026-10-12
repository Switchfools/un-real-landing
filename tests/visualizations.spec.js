import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { visualizationExample } from '../site/scripts/visualization-schema.js';

test.use({ baseURL: 'http://127.0.0.1:4312' });
async function proposal(request, spec) {
  const slug = `interactive-${randomUUID()}`;
  const source = `---\ntitle: Interactive thinking\nauthor: Test author\ndate: 2026-10-11\ndraft: true\nsummary: Explore how a small change affects an illustrative path.\naction: Choose one assumption to test.\n---\n\n\`\`\`visualization\n${JSON.stringify(spec)}\n\`\`\`\n`;
  const response = await request.post('/mcp', { headers: { Authorization: 'Bearer local-ai', Accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'propose_essay', arguments: { requestId: randomUUID(), slug, baseRevision: null, commentsRevision: null, source, summary: 'Add an isolated interactive model', resolveCommentIds: [] } } } });
  const body = await response.json(); expect(body.result.isError).not.toBe(true); return body.result.structuredContent.result;
}
async function preview(page, change) {
  await page.goto(`/?proposal=${change.id}&version=1`);
  await page.getByRole('button', { name: 'Reader preview', exact: true }).click();
  return page.locator('#changes-dialog [data-visualization]');
}

test('reviewed visualization runs privately, supports keyboard controls and reset, with no overflow', async ({ page, request }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const figure = await preview(page, await proposal(request, visualizationExample));
  await expect(figure.locator('[data-viz-fallback] svg')).toBeVisible();
  await expect(figure.locator('canvas')).toBeHidden();
  expect(page.workers()).toHaveLength(0);
  await figure.getByRole('button', { name: 'Run visualization' }).click();
  await expect(figure.locator('[data-viz-caption]')).toHaveText('Growth parameter: 1');
  const slider = figure.getByRole('slider', { name: 'Growth' }); await slider.focus(); await slider.press('ArrowRight');
  await expect(figure.locator('[data-viz-caption]')).toHaveText('Growth parameter: 1.05');
  await expect(figure.locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('interactive-visualization.png'), fullPage: true });
  await figure.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(figure.locator('canvas')).toBeHidden(); await expect(slider).toHaveValue('1');
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Approve batch' }).click();
  await page.getByRole('button', { name: 'Close proposed changes' }).click();
  const accepted = page.locator('#preview [data-visualization]');
  await accepted.getByRole('button', { name: 'Run visualization' }).click();
  await expect(accepted.locator('[data-viz-caption]')).toHaveText('Growth parameter: 1');
});

test('generated code cannot access parent data or network; runaway code stops without freezing Studio', async ({ page, request }) => {
  const unexpected = []; page.on('request', request => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:4312') unexpected.push(request.url()); });
  const spec = { ...visualizationExample, code: 'function render() { const root = ({}).constructor.constructor("return globalThis")(); const denied = ["document","window","fetch","localStorage","postMessage","XMLHttpRequest","navigator","process"]; return {commands:[],caption:denied.every(k => typeof root[k] === "undefined") ? "Browser access denied" : "ESCAPED"}; }' };
  let figure = await preview(page, await proposal(request, spec));
  await figure.getByRole('button', { name: 'Run visualization' }).click();
  await expect(figure.locator('[data-viz-caption]')).toHaveText('Browser access denied');
  expect(unexpected).toEqual([]);
  figure = await preview(page, await proposal(request, { ...spec, code: 'function render() { while(true) {} }' }));
  await figure.getByRole('button', { name: 'Run visualization' }).click();
  await expect(figure.locator('[data-viz-status]')).toContainText('stopped');
  await expect.poll(() => page.workers().length).toBe(0);
  await page.getByRole('button', { name: 'Unified diff', exact: true }).click();
  await expect(page.locator('#changes-dialog .diff-content')).toBeVisible();
});

test('outer watchdog terminates a stalled interpreter and leaves the review usable', async ({ page, request }) => {
  // Exercise the independent deadline even if the interpreter stops yielding.
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() { setTimeout(() => this.onmessage?.({ data: { ready: true } }), 10); }
      postMessage() {}
      terminate() { window.stalledWorkerTerminated = true; }
    };
  });
  const figure = await preview(page, await proposal(request, visualizationExample));
  await figure.getByRole('button', { name: 'Run visualization' }).click();
  await expect(figure.locator('[data-viz-status]')).toContainText('took too long');
  expect(await page.evaluate(() => window.stalledWorkerTerminated)).toBe(true);
  await page.getByRole('button', { name: 'Split diff', exact: true }).click();
  await expect(page.locator('#changes-dialog .split-diff')).toBeVisible();
});

test('diagram pointer coordinates match the displayed canvas after resizing', async ({ page, request }) => {
  const figure = await preview(page, await proposal(request, { ...visualizationExample, code: 'function render({width,pointer}) { return {commands:[],caption:Math.round(pointer.x/width*100)+"%"}; }' }));
  await figure.getByRole('button', { name: 'Run visualization' }).click();
  await expect(figure.locator('[data-viz-caption]')).toHaveText('0%');
  for (const width of [390, 1100]) {
    await page.setViewportSize({ width, height: 1000 });
    const canvas = figure.locator('canvas'); await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(figure.locator('[data-viz-caption]')).toHaveText('50%');
  }
});

test('animation requires Play, honors reduced motion, and workers stop when previews close', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const figure = await preview(page, await proposal(request, { ...visualizationExample, animated: true, code: 'function render({time}) { return {commands:[],caption:time.toFixed(2)}; }' }));
  await figure.getByRole('button', { name: 'Run visualization' }).click();
  await expect(figure.locator('[data-viz-caption]')).toHaveText('0.00');
  await page.waitForTimeout(250); await expect(figure.locator('[data-viz-caption]')).toHaveText('0.00');
  await figure.getByRole('button', { name: 'Play animation' }).click();
  await expect(figure.locator('[data-viz-caption]')).not.toHaveText('0.00');
  await page.getByRole('button', { name: 'Close proposed changes' }).click();
  await expect.poll(() => page.workers().length).toBe(0);
});

test('a saved invalid visualization opens for review and can be corrected through a new proposal version', async ({ page, request }, testInfo) => {
  const headers = { Authorization: 'Bearer local-author', Origin: 'http://127.0.0.1:4312' };
  const slug = `legacy-visual-${testInfo.project.name}`;
  const list = await request.get(`/api/proposals?slug=${slug}`, { headers });
  const [change] = await list.json(); expect(change).toBeTruthy();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?proposal=${change.id}&version=1`);
  const review = page.locator('#changes-dialog');
  await expect(review).toBeVisible();
  await expect(review.locator('.proposal-detail > [role=status]')).toContainText('lineWidth must be between 0 and 20');
  await expect(review.getByRole('button', { name: 'Approve batch' })).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Reject batch' })).toBeEnabled();
  await expect(review.locator('.diff-content')).toContainText('Preserve this essay.');
  await review.getByRole('button', { name: 'Reader preview', exact: true }).click();
  await expect(review.locator('.essay-embed-error')).toBeVisible();
  await expect(review.locator('.proposal-preview')).toContainText('Preserve this essay.');
  await expect(review.locator('[data-viz-spec]')).toHaveCount(0);
  expect(page.workers()).toHaveLength(0);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const stored = await (await request.get(`/api/proposals/${change.id}`, { headers })).json();
  const revise = source => request.post('/mcp', { headers: { Authorization: 'Bearer local-ai', Accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'revise_proposal', arguments: { requestId: randomUUID(), slug, proposalId: change.id, expectedVersion: 1, baseRevision: null, commentsRevision: null, source, summary: 'Correct the static fallback stroke.', resolveCommentIds: [] } } } });
  const refused = await (await revise(stored.source)).json();
  expect(refused.result.isError).toBe(true);
  expect(refused.result.content[0].text).toContain('lineWidth must be between 0 and 20');
  const corrected = await (await revise(stored.source.replace('"lineWidth":94', '"lineWidth":3'))).json();
  expect(corrected.result.isError).not.toBe(true);
  expect(corrected.result.structuredContent.result.version).toBe(2);
  await page.goto(`/?proposal=${change.id}&version=2`);
  await expect(review.getByRole('button', { name: 'Approve batch' })).toBeEnabled();
  await review.getByRole('button', { name: 'Reader preview', exact: true }).click();
  await expect(review.locator('[data-viz-fallback] svg')).toBeVisible();
  await expect(review.locator('.essay-embed-error')).toHaveCount(0);
  await review.getByRole('button', { name: 'Approve batch' }).click();
  await expect(review).toContainText('accepted');
  const original = await (await request.get(`/api/proposals/${change.id}?version=1`, { headers })).json();
  expect(original.source).toBe(stored.source);
  expect(errors).toEqual([]);
});
