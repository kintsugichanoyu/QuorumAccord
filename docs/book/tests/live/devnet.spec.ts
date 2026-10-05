/** Opt-in actual browser -> public devnet smoke test. No RPC routes/mocks. */
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('browser reads the actual devnet deployment without signing or fallback prices', async ({ page }, info) => {
  const methods: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith('https://api.devnet.solana.com') && request.method() === 'POST')
      methods.push((request.postDataJSON() as { method: string }).method);
  });
  await page.goto('/devnet.html');
  await page.getByRole('button', { name: 'Read confirmed accounts' }).click();
  await expect(page.locator('[data-status]')).toContainText('Confirmed RPC context slot', { timeout: 50_000 });
  await expect(page.locator('.quorum-price')).toHaveCount(3);
  await expect(page.locator('.quorum-badge')).toHaveCount(3);
  expect(methods).toEqual(['getGenesisHash', 'getSlot', 'getMultipleAccounts']);
  const report = { network: 'devnet', mock_rpc: false, observed_at: new Date().toISOString(),
    context: await page.locator('[data-status]').textContent(),
    prices: await page.locator('.quorum-price').allTextContents(),
    freshness: await page.locator('.quorum-badge').allTextContents(),
    rpc_methods: methods, status: 'passed' };
  await writeFile(info.outputPath('devnet-live.json'), JSON.stringify(report, null, 2) + '\n');
  await page.screenshot({ path: info.outputPath('devnet-live.png'), fullPage: true });
  console.log(JSON.stringify(report));
});
