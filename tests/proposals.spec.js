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
