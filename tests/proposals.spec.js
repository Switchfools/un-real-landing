import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

test.use({ baseURL: 'http://127.0.0.1:4312' });
const source = text => `---\ntitle: An idea worth testing\ndescription: A belief put to work.\nauthor: Nicolás\ndate: "2026-10-08"\nsummary: Keep judgment with the human.\naction: Test one assumption this week.\ndraft: true\n---\n\n## Start here\n\n${text}\n`;
async function mcp(request, name, arguments_) {
  const response = await request.post('/mcp', { headers: { Authorization: 'Bearer local-ai', Accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ } } });
  expect(response.status()).toBe(200); const body = await response.json(); expect(body.error).toBeUndefined(); expect(body.result.isError).not.toBe(true); return body.result.structuredContent.result;
}

test('ChatGPT proposal is reviewed visually and accepted only through Studio', async ({ page, request }, testInfo) => {
  const slug = `review-${randomUUID()}`;
  const proposal = await mcp(request, 'propose_essay', { requestId: randomUUID(), slug, baseRevision: null, commentsRevision: null, source: source('Understanding should lead to deliberate action.'), summary: 'Turn our conversation into a first draft.', resolveCommentIds: [] });
  await page.goto(`/?proposal=${proposal.id}&version=1`);
  const review = page.locator('#changes-dialog');
  await expect(review).toBeVisible();
  await expect(review.locator('.diff-line.added')).not.toHaveCount(0);
  await review.getByRole('button', { name: 'Reader preview', exact: true }).click();
  await expect(review.locator('.proposal-preview')).toContainText('Understanding should lead to deliberate action.');
  await review.getByRole('button', { name: 'Split diff', exact: true }).click();
  await expect(review.locator('.split-diff')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await review.getByRole('button', { name: 'Approve batch' }).click();
  await expect(review).toContainText('accepted');
  await review.getByRole('button', { name: 'Close proposed changes' }).click();
  await expect(page.locator('#body')).toHaveValue(/Understanding should lead/);
  await page.screenshot({ path: testInfo.outputPath('hosted-studio.png'), fullPage: true });
  const current = await mcp(request, 'get_essay', { slug });
  expect(current.published).toBe(false);
  const note = { id: 'clarify-action', field: 'body', quote: 'deliberate action', text: 'Make the action more concrete.', resolved: false };
  const saved = await request.put(`/api/essays/${slug}`, { headers: { Authorization: 'Bearer local-author', Origin: 'http://127.0.0.1:4312' }, data: { ...current, comments: [note] } });
  const draft = await saved.json(); expect(saved.status()).toBe(200);
  const change = await mcp(request, 'propose_revision', { requestId: randomUUID(), slug, baseRevision: draft.revision, commentsRevision: draft.commentsRevision, source: source('Write down one assumption and test it with a small experiment.'), summary: 'Address the comment with a specific action.', resolveCommentIds: [note.id] });
  await page.goto(`/?proposal=${change.id}&version=1`);
  await expect(review.locator('.comment-resolutions')).toContainText(note.text);
  await review.getByRole('button', { name: 'Approve batch' }).click();
  await expect(review).toContainText('accepted');
  const accepted = await mcp(request, 'get_essay', { slug }); expect(accepted.comments[0].resolved).toBe(true);
  expect(accepted.published).toBe(false);
});

test('an outdated visible proposal cannot be accepted after ChatGPT revises it', async ({ page, request }) => {
  const slug = `stale-${randomUUID()}`, input = { requestId: randomUUID(), slug, baseRevision: null, commentsRevision: null, source: source('The first version.'), summary: 'First version.', resolveCommentIds: [] };
  const first = await mcp(request, 'propose_essay', input);
  await page.goto(`/?proposal=${first.id}&version=1`);
  const review = page.locator('#changes-dialog'); await expect(review).toBeVisible();
  await mcp(request, 'revise_proposal', { ...input, requestId: randomUUID(), proposalId: first.id, expectedVersion: 1, source: source('A different second version.'), summary: 'Second version.' });
  await review.getByRole('button', { name: 'Approve batch' }).click();
  await expect(review.getByRole('status')).toContainText('changed');
  const essays = await mcp(request, 'list_essays', {}); expect(essays.some(essay => essay.slug === slug)).toBe(false);
});

test('MCP image and diagram proposals render safely before the author accepts them', async ({ page, request }) => {
  const slug = `visual-${randomUUID()}`;
  const first = await mcp(request, 'propose_essay', { requestId: randomUUID(), slug, baseRevision: null, commentsRevision: null, source: source('An idea with a visual explanation.'), summary: 'First draft', resolveCommentIds: [] });
  const image = await mcp(request, 'stage_image', { requestId: randomUUID(), slug, alt: 'A visual safeguard', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZfoAAAAASUVORK5CYII=' });
  const diagram = '```diagram\n{"title":"Review before action","nodes":[{"id":"review","label":"Review"},{"id":"act","label":"Act"}],"edges":[{"from":"review","to":"act"}]}\n```';
  const snippet = '```html\n<details open><summary>Explain the choice</summary><p onclick="window.injected=true">Keep agency with the author.</p><script>window.injected=true</script></details>\n```';
  await mcp(request, 'revise_proposal', { requestId: randomUUID(), proposalId: first.id, expectedVersion: 1, slug, baseRevision: null, commentsRevision: null, source: source(image.markdown + '\n\n' + diagram + '\n\n' + snippet), summary: 'Add a diagram, image and explanation', resolveCommentIds: [] });
  await page.goto(`/?proposal=${first.id}&version=2`);
  const review = page.locator('#changes-dialog');
  await review.getByRole('button', { name: 'Reader preview', exact: true }).click();
  const picture = review.locator('img[alt="A visual safeguard"]');
  await expect.poll(() => picture.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(review.getByRole('img', { name: 'Review before action' })).toBeVisible();
  await review.getByText('Keep agency with the author.', { exact: true }).click();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(review.locator('.proposal-preview script, .proposal-preview [onclick]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await review.getByRole('button', { name: 'Approve batch' }).click();
  await expect(review).toContainText('accepted');
  expect((await mcp(request, 'get_essay', { slug })).published).toBe(false);
});

test('configured online voice has a playable library sample without generating narration', async ({ page }) => {
  const wav = Buffer.alloc(44 + 16000 * 2); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const generated = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/narration')) generated.push(request.url()); });
  await page.route('**/api/audio-settings', route => route.fulfill({ json: { connected: true, voiceId: 'voice1', narrator: 'Test reader' } }));
  await page.route('**/api/voices', route => route.fulfill({ json: [{ id: 'voice1', name: 'Test reader', description: 'Warm', hasPreview: true }, { id: 'voice2', name: 'Other reader', description: '', hasPreview: false }] }));
  await page.route('**/api/voices/voice1/preview', route => route.fulfill({ json: { name: 'Test reader', type: 'audio/wav', data: wav.toString('base64') } }));
  await page.goto('/#from-belief-to-action');
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await expect(page.locator('#voice-id')).toHaveValue('voice1');
  await page.getByRole('button', { name: 'Listen to selected voice' }).click();
  await expect(page.locator('#voice-audition')).toBeVisible();
  await expect.poll(() => page.locator('#voice-audition').evaluate(audio => audio.readyState)).toBeGreaterThan(0);
  await expect(page.locator('#voice-library-status')).toContainText('Test reader');
  expect(generated).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#voice-list').selectOption('voice2');
  await expect(page.locator('#voice-audition')).toBeHidden();
});
