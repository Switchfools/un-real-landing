import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSite } from '../scripts/build.mjs';

for (const path of ['/', '/un-real-landing/']) {
  test(`loads the full site and every asset at ${path}`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => errors.push(request.url()));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The future of AIis notpredetermined.');
    await expect(page.locator('[data-attractor]')).toHaveAttribute('data-animation', 'running');
    for (const image of await page.locator('img').all()) {
      expect(await image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    }
    await expect(page.getByRole('link', { name: 'Let’s start a conversation' })).toHaveAttribute('href', 'mailto:contact-us@un-real.ai');
    for (const name of ['Mission', 'Alignment', 'Essays', 'Get in touch']) {
      const link = page.getByRole('navigation').getByRole('link', { name });
      const href = await link.getAttribute('href');
      await link.click();
      await expect(page.locator(href)).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    expect(await page.locator('body').innerText()).not.toMatch(/Codesphere|API integration|advisory board|our clients|pricing|Typeform/i);
    if (path === '/') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); return document.fonts.ready; });
      await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true });
    }
  });
}

test('motion starts, can be paused by keyboard, and resumes', async ({ page }, testInfo) => {
  await page.goto('/');
  const figure = page.locator('[data-attractor]');
  const snapshot = () => figure.locator('canvas').evaluate(node => node.toDataURL());
  await expect(figure).toHaveAttribute('data-animation', 'running');
  const moving = await snapshot();
  await expect.poll(snapshot).not.toBe(moving);
  const button = figure.locator('.motion-toggle');
  await button.focus();
  await page.keyboard.press('Space');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toContainText('Resume motion');
  const paused = await snapshot();
  await figure.screenshot({ path: testInfo.outputPath('attractor.png') });
  await page.waitForTimeout(200);
  expect(await snapshot()).toBe(paused);
  await page.keyboard.press('Enter');
  await expect.poll(snapshot).not.toBe(paused);
});

test('offscreen and hidden tabs suspend motion without overriding a user pause', async ({ page }) => {
  await page.goto('/');
  const figure = page.locator('[data-attractor]');
  await expect(figure).toHaveAttribute('data-animation', 'running');
  await page.locator('#contact').scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute('data-animation', 'paused');
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute('data-animation', 'running');
  // Deterministic event: headless browsers need not hide background pages.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(figure).toHaveAttribute('data-animation', 'paused');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(figure).toHaveAttribute('data-animation', 'running');
  await figure.locator('.motion-toggle').click();
  await page.locator('#contact').scrollIntoViewIfNeeded();
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute('data-animation', 'paused');
});

test('reduced motion and preference changes use the static butterfly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const figure = page.locator('[data-attractor]');
  await expect(figure).toHaveAttribute('data-animation', 'static');
  await expect(figure.locator('.attractor-fallback')).toBeVisible();
  await expect(figure.locator('canvas')).toHaveCSS('opacity', '0');
  await expect(figure.locator('.motion-toggle')).toBeHidden();
  await expect(figure.locator('.view-reset')).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(figure).toHaveAttribute('data-animation', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(figure).toHaveAttribute('data-animation', 'static');
});

test('static content and brand work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/un-real-landing/');
  await expect(page.locator('.attractor-fallback')).toBeVisible();
  await expect(page.locator('#contact-title')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Let’s start a conversation' })).toHaveAttribute('href', 'mailto:contact-us@un-real.ai');
  await expect(page.locator('.motion-toggle')).toBeHidden();
  await context.close();
});

test('canvas failure retains the static fallback', async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await page.goto('/');
  await expect(page.locator('.attractor-fallback')).toBeVisible();
  await expect(page.locator('.attractor-canvas')).toHaveCSS('opacity', '0');
  await expect(page.locator('.motion-toggle')).toBeHidden();
});

test('resizes without clipping, overflow, or excessive pixel density', async ({ page }) => {
  await page.goto('/');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.locator('canvas').evaluate(node => Math.abs(node.width - Math.round(node.clientWidth * Math.min(devicePixelRatio, 2))))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('page meets automated WCAG AA checks and exposes a skip link', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('3D view can be dragged and reset while the flow stays paused', async ({ page }) => {
  await page.goto('/');
  const figure = page.locator('[data-attractor]');
  await figure.scrollIntoViewIfNeeded();
  await figure.locator('.motion-toggle').click();
  const snapshot = () => figure.locator('canvas').evaluate(node => node.toDataURL());
  const original = await snapshot();
  const bounds = await figure.locator('.attractor-viewport').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.6, { steps: 10 });
  await page.mouse.up();
  expect(await snapshot()).not.toBe(original);
  await expect(figure).toHaveAttribute('data-animation', 'paused');
  await figure.getByRole('button', { name: 'Reset 3D view' }).click();
  expect(await snapshot()).toBe(original);
});

test('published Markdown essays have working Pages links and an action section', async ({ page }, testInfo) => {
  const outDir = testInfo.outputPath('dist');
  await buildSite({ contentDir: resolve('tests/fixtures/essays'), outDir });
  const home = await readFile(resolve(outDir, 'index.html'), 'utf8');
  const essay = await readFile(resolve(outDir, 'essays/from-belief-to-action/index.html'), 'utf8');
  await page.route('http://127.0.0.1:4173/un-real-landing/', route => route.fulfill({ contentType: 'text/html', body: home }));
  await page.route('**/essays/from-belief-to-action/', route => route.fulfill({ contentType: 'text/html', body: essay }));
  await page.goto('/un-real-landing/#essays');
  await page.locator('.essay-link').click();
  await expect(page).toHaveURL(/\/un-real-landing\/essays\/from-belief-to-action\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('From belief to action');
  await expect(page.locator('.essay-prose strong')).toHaveText('testable commitment');
  await expect(page.locator('.essay-action')).toContainText('Write down one assumption and test it this week.');
  await expect(page.locator('.essay-action a')).toHaveAttribute('href', 'mailto:contact-us@un-real.ai');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('essay.png'), fullPage: true });
  await page.getByRole('link', { name: 'All essays' }).click();
  await expect(page).toHaveURL(/\/un-real-landing\/#essays$/);
});
