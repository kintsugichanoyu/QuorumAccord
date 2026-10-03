/** TypeScript account-fixture allocation and trigger/brake integration tests. */
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { SigningClient } from './client.js';
import { decodeAllocation, decodeMock, Instructions, type FeedConfig } from './codec.js';
import { type Asset } from './types.js';

export const VENUES = [[1, 1000n, 2000n], [2, 1200n, 4000n], [3, 800n, 1000n], [4, 1500n, 7000n], [5, 600n, 3000n]] as const;
export const GOLDEN = [3007, 2707, 2707, 0, 1579, ...Array<number>(11).fill(0)];
export function fixtureWeights(inputs: { apy: bigint; crr: bigint }[]): number[] {
  const raw = inputs.map(v => v.crr >= 6000n ? 0n : v.apy * (10_000n - v.crr) / 10_000n);
  const total = raw.reduce((sum, n) => sum + n, 0n);
  if (!total) return raw.map(() => 0);
  const weights = raw.map(n => Number(n * 10_000n / total));
  const ranked = raw.map((n, index) => ({ index, remainder: n * 10_000n % total }))
    .sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.index - b.index);
  let remaining = 10_000 - weights.reduce((sum, n) => sum + n, 0);
  for (const item of ranked) if (remaining > 0 && raw[item.index]! > 0n) { weights[item.index]!++; remaining--; }
  return weights;
}
function asset(pool: number, data = 0): Asset { return { symbol: 'SOL', pool_id: pool, data_id: data, base_price_micro_usd: '1' }; }
function config(width: number, overrides: Partial<FeedConfig> = {}): FeedConfig {
  return { window_slots: width, threshold_bps: 30, min_interval_slots: 0, max_interval_slots: width,
    min_number: 2, measurand: 0, rule: 1, trim_pct: 0, ...overrides };
}
async function ensureFeed(c: SigningClient, a: Asset, cfg: FeedConfig) {
  const key = c.ix.feed(a.pool_id, a.data_id);
  if (!await c.exists(key)) await c.send(c.admin, c.ix.initFeed(c.admin.publicKey, a.pool_id, a.data_id, cfg));
  else await c.send(c.admin, c.ix.updateFeed(c.admin.publicKey, a.pool_id, a.data_id, cfg));
}
async function vote(c: SigningClient, a: Asset, window: bigint, value: bigint, index: number) {
  const operator = c.operators[index]!;
  const key = c.ix.samplePda(a.pool_id, a.data_id, window);
  await c.send(operator, c.ix.sample(await c.exists(key) ? 'corroborate_sample' : 'propose_sample', operator.publicKey,
    a.pool_id, a.data_id, window, value, await c.slot()));
}
async function round(c: SigningClient, a: Asset, value: bigint) {
  await c.fund(c.admin, c.operators, 500_000_000);
  const width = (await c.feed(a)).window_slots;
  const { window, closes } = await c.nextWindow(width);
  await vote(c, a, window, value, 0);
  await vote(c, a, window, value, 1);
  await c.waitSlot(closes + 2n);
  await c.send(c.admin, c.ix.finalizeSample(c.admin.publicKey, a.pool_id, a.data_id, window));
  return await c.feed(a);
}
export async function allocationGolden(c: SigningClient) {
  const mock = new Instructions(new PublicKey(c.config.mock_program_id));
  const width = Math.max(120, c.config.window_slots);
  await c.fund(c.admin, c.operators, 500_000_000);
  const fixtures: { asset: Asset; id: number; value: bigint }[] = [];
  for (const [index, [pool, apy, crr]] of VENUES.entries()) {
    fixtures.push({ asset: asset(pool, 0), id: index * 2, value: apy }, { asset: asset(pool, 2), id: index * 2 + 1, value: crr });
  }
  for (const fixture of fixtures) {
    if (!await c.exists(mock.mock(fixture.id))) await c.send(c.admin, mock.initMock(c.admin.publicKey, fixture.id));
    await c.send(c.admin, mock.writeMock(c.admin.publicKey, fixture.id, fixture.value));
    await ensureFeed(c, fixture.asset, config(width));
  }
  const { window, closes } = await c.nextWindow(width);
  for (const fixture of fixtures) {
    const account = await c.connection.getAccountInfo(mock.mock(fixture.id), 'confirmed');
    assert(account && account.owner.equals(mock.program), 'mock account missing/wrong owner');
    const value = decodeMock(account.data);
    assert.equal(value, fixture.value);
    for (let i = 0; i < 2; i++) await vote(c, fixture.asset, window, value, i);
  }
  await c.waitSlot(closes + 2n);
  for (const fixture of fixtures) {
    await c.send(c.admin, c.ix.finalizeSample(c.admin.publicKey, fixture.asset.pool_id, fixture.asset.data_id, window));
    assert.equal((await c.feed(fixture.asset)).last_value, fixture.value);
  }
  const submissions = [];
  for (let i = 0; i < 2; i++) {
    const inputs = [];
    for (const [pool] of VENUES) inputs.push({ apy: (await c.feed(asset(pool, 0))).price, crr: (await c.feed(asset(pool, 2))).price });
    const weights = [...fixtureWeights(inputs), ...Array<number>(11).fill(0)];
    assert.deepEqual(weights, GOLDEN);
    submissions.push(weights);
  }
  assert.deepEqual(submissions[0], submissions[1]);
  const index = await c.slot();
  const closing = index + BigInt(width);
  await c.send(c.admin, c.ix.openAllocation(c.admin.publicKey, index, closing));
  for (let i = 0; i < 2; i++) await c.send(c.operators[i]!, c.ix.submitWeights(c.operators[i]!.publicKey, index, submissions[i]!));
  await c.waitSlot(closing + 2n);
  await c.send(c.admin, c.ix.finalizeAllocation(c.admin.publicKey, index));
  const published = decodeAllocation((await c.account(c.ix.allocationState())).data);
  assert.deepEqual(published.weights, GOLDEN);
  assert.equal(published.round, index);
  assert.equal(published.weights.reduce((sum, n) => sum + n), 10_000);
  return { ...published, feed_count: fixtures.length, matching_consumer_submissions: submissions };
}

export function invariantCases(c: SigningClient): [string, () => Promise<unknown>][] {
  const width = c.config.window_slots;
  return [
    ['allocation fixture quorum miss', async () => {
      const a = asset(10);
      await ensureFeed(c, a, config(width, { min_number: 3 }));
      const before = await c.feed(a);
      const after = await round(c, a, 1234n);
      assert.equal(after.tick, before.tick);
      assert.equal(after.last_value, before.last_value);
      return { unchanged: true };
    }],
    ['minimum interval brake', async () => {
      const a = asset(11);
      await ensureFeed(c, a, config(width));
      const before = await round(c, a, 1000n);
      await ensureFeed(c, a, config(width, { min_interval_slots: 1000, max_interval_slots: 1_000_000 }));
      const after = await round(c, a, 5000n);
      assert.equal(after.tick, before.tick);
      assert.equal(after.last_finalized_slot, before.last_finalized_slot);
      return { tick_before: before.tick, tick_after: after.tick, braked: true };
    }],
    ['no-trigger window', async () => {
      const a = asset(12);
      await ensureFeed(c, a, config(width));
      const before = await round(c, a, 10_000n);
      await ensureFeed(c, a, config(width, { threshold_bps: 500, max_interval_slots: 1_000_000 }));
      const after = await round(c, a, 10_200n);
      assert.equal(after.tick, before.tick);
      assert.equal(after.last_value, 10_000n);
      return { unchanged: true };
    }],
    ['forced refresh', async () => {
      const a = asset(13);
      await ensureFeed(c, a, config(width, { threshold_bps: 60_000, max_interval_slots: 30 }));
      const before = await round(c, a, 5000n);
      const after = await round(c, a, 5000n);
      assert.equal(after.tick, before.tick + 1n);
      assert.equal(after.last_value, 5000n);
      return { tick_before: before.tick, tick_after: after.tick };
    }],
    ['unauthorized opener cannot create consensus', async () => {
      const a = asset(14);
      await ensureFeed(c, a, config(width));
      const { window } = await c.nextWindow();
      await c.reject(c.outsider, c.ix.sample('propose_sample', c.outsider.publicKey, a.pool_id, a.data_id, window, 1234n, await c.slot()), 6001);
      assert.equal(await c.exists(c.ix.samplePda(a.pool_id, a.data_id, window)), false);
      return { error_code: 6001, consensus_created: false };
    }],
  ];
}
