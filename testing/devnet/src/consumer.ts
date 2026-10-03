/** Read-only price consumer: no backend access and no signing wallet required. */
import assert from 'node:assert/strict';
import { ChainClient } from './client.js';
import { decodeFeed } from './codec.js';

export function fresh(finalizedSlot: bigint, context: bigint, tolerance: bigint): boolean {
  return finalizedSlot > 0n && finalizedSlot <= context && context - finalizedSlot <= tolerance;
}
export async function consumePrices(client: ChainClient) {
  await client.verifyNetwork();
  const prices = [];
  for (const asset of client.config.assets) {
    const key = client.ix.feed(asset.pool_id, asset.data_id);
    const { data, context } = await client.account(key);
    const view = decodeFeed(data);
    assert.equal(view.pool_id, asset.pool_id, 'wrong feed pool');
    assert.equal(view.data_id, asset.data_id, 'wrong feed metric');
    assert.equal(view.window_slots, client.config.window_slots, 'unexpected feed window');
    assert(view.tick > 0n, `no consensus price for ${asset.symbol}`);
    assert(fresh(view.last_finalized_slot, context, BigInt(4 * client.config.window_slots)), `stale/future price for ${asset.symbol}`);
    assert.equal(view.price, view.last_value, 'ring/header price mismatch');
    assert(view.price > 0n, 'zero consensus price');
    prices.push({ symbol: asset.symbol, price_micro_usd: view.price, tick: view.tick,
      finalized_window_slot: view.last_finalized_slot, rpc_context_slot: context, feed: key.toBase58() });
  }
  return { network: client.config.network, program: client.config.program_id, decimals: 6, prices };
}
