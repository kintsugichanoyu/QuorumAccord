import { test, expect, type Page } from '@playwright/test';
import { DEVNET_GENESIS, DISCRIMINATORS, PROGRAM } from '../../ui/model.ts';

function feed(pool: number, value: bigint) {
  const bytes = Buffer.alloc(8248); bytes.set(DISCRIMINATORS.DataFeed);
  bytes.writeBigUInt64LE(1n, 8); bytes.writeBigUInt64LE(100n, 16); bytes.writeBigUInt64LE(value, 24);
  bytes.writeUInt32LE(240, 32); bytes.writeUInt16LE(1, 46); bytes[48] = pool; bytes[49] = 240;
  bytes.writeBigUInt64LE(value, 56);
  return { owner: PROGRAM, data: [bytes.toString('base64'), 'base64'] };
}
async function mockRpc(page: Page, context = 201, wrongGenesis = false) {
  const methods: string[] = [];
  await page.route('https://api.devnet.solana.com/', async route => {
    const request = route.request().postDataJSON() as { method: string }; methods.push(request.method);
    const result = request.method === 'getGenesisHash' ? wrongGenesis ? 'wrong' : DEVNET_GENESIS
      : request.method === 'getSlot' ? context : { context: { slot: context }, value:
        [feed(160, 198_250_000n), feed(161, 64_000_000_000n), feed(162, 3_200_000_000n), null] };
    await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });
  return methods;
}
test('mdBook navigation, protocol integration disclosure and search render', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByRole('heading', { name: 'One feed. Many operators.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.goto('/protocols/kamino.html');
  await expect(page.getByText('Status: real protocol adapter not implemented.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Driver contract', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Integrate a protocol', exact: true })).toBeVisible();
  await page.goto('/blockers.html');
  await page.getByRole('link', { name: 'testing/devnet/RESULTS.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verification and troubleshooting', exact: true })).toBeVisible();
  await page.goto('/blockers.html');
  await page.getByRole('link', { name: 'docs/book/README.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run the TypeScript lab', exact: true })).toBeVisible();
});
test('inspector renders exact prices using only three read-only RPC calls', async ({ page }, testInfo) => {
  const methods = await mockRpc(page);
  await page.goto('/devnet.html');
  await expect(page.locator('[data-snapshot]')).toContainText('Recorded test status:');
  await page.getByRole('button', { name: 'Read confirmed accounts' }).click();
  await expect(page.locator('.reflect-price').first()).toHaveText('$198.25');
  await expect(page.locator('.reflect-price').nth(1)).toHaveText('$64,000');
  await expect(page.locator('.reflect-badge.fresh')).toHaveCount(3);
  await expect(page.locator('[data-status]')).toContainText('context slot 201');
  expect(methods).toEqual(['getGenesisHash', 'getSlot', 'getMultipleAccounts']);
  await page.screenshot({ path: testInfo.outputPath('devnet-inspector.png'), fullPage: true });
});
test('wrong network is rejected before account reads', async ({ page }) => {
  const methods = await mockRpc(page, 201, true);
  await page.goto('/devnet.html');
  await page.getByRole('button', { name: 'Read confirmed accounts' }).click();
  await expect(page.locator('[data-status]')).toHaveText('RPC is not Solana devnet');
  expect(methods).toEqual(['getGenesisHash']);
  await expect(page.locator('.reflect-price')).toHaveCount(0);
});
test('mobile stale-price display remains readable without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockRpc(page, 1061);
  await page.goto('/devnet.html');
  await page.getByRole('button', { name: 'Read confirmed accounts' }).click();
  await expect(page.locator('.reflect-badge.stale')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-stale.png'), fullPage: true });
});
test('transport errors are shown instead of substituted snapshot prices', async ({ page }) => {
  await page.route('https://api.devnet.solana.com/', route => route.fulfill({ status: 429, body: 'limited' }));
  await page.goto('/devnet.html');
  await page.getByRole('button', { name: 'Read confirmed accounts' }).click();
  await expect(page.locator('[data-status]')).toContainText('RPC HTTP 429');
  await expect(page.locator('.reflect-price')).toHaveCount(0);
});
