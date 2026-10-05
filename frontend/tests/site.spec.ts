import { expect, test } from '@playwright/test';

test('project purpose, Rust worker guide, and bundled mdBook navigation work', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  await page.goto('/');
  await expect(page).toHaveTitle(/Quorum/);
  await expect(page.getByRole('heading', { name: /Independent workers. Shared conviction./ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('quorum-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Integrate a worker', exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'Integrate Quorum workers', exact: true })).toBeVisible();
  await expect(page.getByText('quorum-producer', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.getByRole('heading', { name: 'Configure a consumer', exact: true }).getByRole('link').click();
  await expect(page).toHaveURL(/workers.html#configure-a-consumer$/);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('quorum demo rejects insufficient votes and restores the median example', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-result]')).toContainText('525 bps');
  await page.getByRole('button', { name: 'Below quorum' }).click();
  await expect(page.locator('[data-votes]')).toHaveText('3 of 6 votes');
  await expect(page.locator('[data-result]')).toContainText('No publication');
  await expect(page.locator('.operator.inactive')).toHaveCount(3);
  await expect(page.locator('[data-demo-note]')).toContainText('previously published value is retained');
  await page.getByRole('button', { name: 'Quorum reached' }).click();
  await expect(page.locator('[data-result]')).toContainText('525 bps');
  await expect(page.locator('.operator.inactive')).toHaveCount(0);
});

test('worker tabs support keyboard navigation and copy the selected command', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Producer' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Consumer' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('quorum-consumer');
  await page.getByRole('button', { name: 'Copy worker command' }).click();
  await expect(page.locator('[data-copy-status]')).toHaveText('Worker command copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('--bin quorum-consumer');
  await page.getByRole('tab', { name: 'Consumer' }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tabpanel')).toContainText('quorum-producer');
});

test('handbook entry points and static server responses are valid', async ({ page, request }) => {
  await page.goto('/');
  const links = await page.locator('a[href^="book/"]').evaluateAll(elements =>
    [...new Set(elements.map(element => element.getAttribute('href')!))]);
  for (const link of links) expect((await request.get(`/${link}`)).status(), link).toBe(200);
  const head = await request.head('/styles.css');
  expect(head.status()).toBe(200);
  expect(head.headers()['content-type']).toContain('text/css');
  expect(head.headers()['x-content-type-options']).toBe('nosniff');
  expect((await request.get('/not-a-real-page.html')).status()).toBe(404);
  expect((await request.post('/')).status()).toBe(405);
  expect((await request.get('/Cargo.toml')).status()).toBe(404);
  expect((await request.get('/book/evidence/latest-devnet.json')).status()).toBe(200);
});

test('mobile layout, navigation, and worker example stay usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Workers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('tab', { name: 'Consumer' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('quorum-consumer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('quorum-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
