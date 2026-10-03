import assert from 'node:assert/strict';
import { SigningClient } from './client.js';
import { decodeSample } from './codec.js';
import { PROTOCOLS, type Quote, validateQuote } from './types.js';

export async function provide(client: SigningClient, index: number, window: bigint) {
  assert(Number.isInteger(index) && index >= 0 && index < 3, 'operator index must be 0..2');
  const operator = client.operators[index]!;
  const protocol = PROTOCOLS[index]!;
  const reports = [];
  for (const asset of client.config.assets) {
    const response = await fetch(`${client.config.backend_url}/v1/protocols/${protocol}/prices/${asset.symbol}`, { signal: AbortSignal.timeout(10_000) });
    assert(response.ok, `backend HTTP ${response.status} for ${protocol}/${asset.symbol}`);
    const quote = await response.json() as Quote;
    const price = validateQuote(quote, protocol, asset.symbol);
    const slot = await client.slot();
    assert.equal(slot / BigInt(client.config.window_slots), window, `missed price window ${window}`);
    const consensus = client.ix.samplePda(asset.pool_id, asset.data_id, window);
    const instruction = client.ix.sample(await client.exists(consensus) ? 'corroborate_sample' : 'propose_sample',
      operator.publicKey, asset.pool_id, asset.data_id, window, price, slot);
    let signature: string;
    try { signature = await client.send(operator, instruction); }
    catch (original) {
      if (!await client.exists(consensus)) throw original;
      const account = await client.account(consensus);
      const view = decodeSample(account.data);
      assert(!view.submissions.some(s => s.operator === operator.publicKey.toBase58()), 'ambiguous confirmation: operator already submitted');
      signature = await client.send(operator, client.ix.sample('corroborate_sample', operator.publicKey, asset.pool_id, asset.data_id, window, price, slot));
    }
    reports.push({ symbol: asset.symbol, price_micro_usd: price, phase: quote.phase, signature });
  }
  return { operator: operator.publicKey.toBase58(), protocol, window, reports };
}
