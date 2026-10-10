import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = 'http://127.0.0.1:4311';
const headers = { Origin: base };
const source = `---\ntitle: "A considered idea"\nauthor: "Nicolás Vergara"\ndescription: "An idea about safeguards."\nsummary: "Expect failures and build safeguards."\naction: "Test one safeguard."\ndate: "2026-10-08"\ndraft: true\n---\n\n## A question\n\nA distinct passage worth revisiting.\n\nFollow the **reasoning**.[^1]\n\n[^1]: A source to examine.\n`;
async function create(page, request, label = 'draft') {
  const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const result = await request.post(`${base}/api/essays`, { headers, data: { slug, source } }); expect(result.status()).toBe(201);
  await page.goto(`${base}/#${slug}`);
  await expect(page.locator('#preview h1')).toHaveText('A considered idea');
  return slug;
}

test('Studio displays an isolated draft, abstract, footnotes and responsive reader without errors', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#a-considered-idea`);
  await expect(page.locator('#preview h1')).toHaveText('A considered idea');
  await expect(page.locator('#summary-count')).toHaveText('5 / 180 words');
  await expect(page.locator('#preview #note-7')).toBeAttached();
  await expect(page.locator('#preview')).not.toContainText('[^1]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('studio.png') });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.editor-pane')).toBeHidden();
  await page.screenshot({ path: info.outputPath('studio-reading.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('edit, comment on highlighted source, save, reload, resolve and prepare a separate final copy', async ({ page, request }) => {
  const slug = await create(page, request, 'editing');
  await page.locator('#title').fill('A clearer idea');
  await page.locator('#body').evaluate(element => { const start = element.value.indexOf('distinct passage'); element.focus(); element.setSelectionRange(start, start + 'distinct passage'.length); element.dispatchEvent(new Event('select')); });
  await page.getByRole('button', { name: 'Comment on selection' }).click();
  await page.locator('#comment-text').fill('Make this concrete.');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await page.getByRole('button', { name: 'Close review panel' }).click();
  await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('Saved on this computer');
  await page.reload(); await expect(page.locator('#title')).toHaveValue('A clearer idea');
  await expect(page.locator('#comment-count')).toHaveText('1');
  await page.getByRole('button', { name: /^Comments/ }).click();
  await expect(page.locator('#comments-list')).toContainText('Make this concrete.');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.getByRole('button', { name: 'Close review panel' }).click();
  await page.getByRole('button', { name: 'Prepare release' }).click();
  await page.getByRole('button', { name: 'Prepare final Markdown' }).click();
  await expect(page.locator('#notice')).toContainText('Final Markdown prepared');
  const stored = await (await request.get(`${base}/api/essays/${slug}`)).json(); expect(stored.published).toBe(true); expect(stored.metadata.draft).toBe(true);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('#history-list button')).toHaveCount(2);
  await page.getByRole('button', { name: /Original import/ }).click();
  await page.getByRole('button', { name: 'Restore to editor' }).click();
  await expect(page.locator('#title')).toHaveValue('A considered idea');
  await page.getByRole('button', { name: 'Close review panel' }).click();
  await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('Saved on this computer');
});

test('image upload, preview selection comment, Markdown export and real audio controls', async ({ page, request }) => {
  await create(page, request, 'media');
  await page.getByRole('button', { name: 'Image ＋' }).click();
  await page.locator('#image-file').setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZfoAAAAASUVORK5CYII=', 'base64') });
  await page.locator('#image-alt').fill('A safeguard diagram');
  await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  // The preview is replaced after the upload and its debounced render complete.
  // Wait for the new content before scrolling, rather than the previous DOM.
  const insertedImage = page.locator('#preview img[alt="A safeguard diagram"]');
  await expect(insertedImage).toBeAttached();
  await insertedImage.scrollIntoViewIfNeeded();
  await expect(insertedImage).toBeVisible();
  await page.locator('#preview .essay-body').evaluate(root => {
    const node = [...root.querySelectorAll('p')].find(p => p.textContent.includes('A distinct passage')).firstChild;
    const range = document.createRange(); range.setStart(node, 2); range.setEnd(node, 18); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Comment on selection' }).click();
  await page.locator('#comment-text').fill('A note from the reading view.'); await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.locator('#comments-list')).toContainText('Passage found');
  await page.getByRole('button', { name: 'Close review panel' }).click();
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await page.locator('#narrator').fill('Test recording');
  // A valid PCM WAV lets the browser verify the same playback path as a recording.
  const wav = Buffer.alloc(44 + 16000 * 2); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await page.locator('#audio-file').setInputFiles({ name: 'narration.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.locator('#audio-current')).toContainText('Test recording');
  await page.getByRole('button', { name: 'Close review panel' }).click();
  await expect(page.locator('#preview audio')).toBeVisible();
  await expect.poll(() => page.locator('#preview audio').evaluate(audio => audio.readyState)).toBeGreaterThan(0);
  await page.locator('[data-audio-speed]').selectOption('1.5'); expect(await page.locator('#preview audio').evaluate(audio => audio.playbackRate)).toBe(1.5);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export .md' }).click(); expect((await download).suggestedFilename()).toMatch(/\.md$/);
  await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('Saved on this computer');
});

test('local API rejects cross-origin writes and missing voice setup gives an actionable error', async ({ page, request }) => {
  expect((await request.post(`${base}/api/essays`, { headers: { Origin: 'https://example.com' }, data: { slug: 'attack', source } })).status()).toBe(403);
  expect((await request.post(`${base}/api/essays`, { data: { slug: 'no-origin', source } })).status()).toBe(403);
  await create(page, request, 'audio-setup');
  await page.getByRole('button', { name: 'Audio', exact: true }).click(); await page.getByRole('button', { name: 'Generate short preview' }).click();
  await expect(page.locator('#notice')).toContainText('Connect ElevenLabs');
  await page.getByRole('button', { name: 'Close review panel' }).click();
});
