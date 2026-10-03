import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createBackend } from '../../src/backend.js';
import { PROTOCOLS, PRICES, validateQuote, type Quote } from '../../src/types.js';

const backend = createBackend();
let url: string;
before(async () => {
  await new Promise<void>(done => backend.listen(0, '127.0.0.1', done));
  const address = backend.address();
  assert(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  backend.closeAllConnections();
  await new Promise<void>(done => backend.close(() => done()));
});
async function phase(value: string) {
  const response = await fetch(`${url}/control/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: value }) });
  return response;
}
test('HTTP: health identifies test-only service', async () => assert.equal((await (await fetch(`${url}/health`)).json()).test_only, true));
test('HTTP: all protocol APIs return exact decimal-string prices', async () => {
  await phase('baseline');
  for (const protocol of PROTOCOLS) for (const symbol of ['SOL', 'BTC', 'ETH'] as const) {
    const quote = await (await fetch(`${url}/v1/protocols/${protocol}/prices/${symbol}`)).json() as Quote;
    assert.equal(validateQuote(quote, protocol, symbol), PRICES[symbol]);
  }
  const state = await (await fetch(`${url}/control/state`)).json();
  assert.deepEqual(state.requests, { atlas: 3, boreal: 3, cygnus: 3 });
});
test('HTTP: outlier is isolated to Cygnus', async () => {
  await phase('outlier');
  for (const protocol of PROTOCOLS) {
    const quote = await (await fetch(`${url}/v1/protocols/${protocol}/prices/SOL`)).json() as Quote;
    assert.equal(validateQuote(quote, protocol, 'SOL'), PRICES.SOL * (protocol === 'cygnus' ? 10n : 1n));
  }
});
test('HTTP: updated values use integer 10-percent scaling', async () => {
  await phase('updated');
  const quote = await (await fetch(`${url}/v1/protocols/atlas/prices/SOL`)).json() as Quote;
  assert.equal(validateQuote(quote, 'atlas', 'SOL'), 218075000n);
});
test('HTTP: outage returns 503 and records the rejected request', async () => {
  await phase('unavailable');
  assert.equal((await fetch(`${url}/v1/protocols/cygnus/prices/SOL`)).status, 503);
  assert.equal((await (await fetch(`${url}/control/state`)).json()).requests.cygnus, 1);
});
test('HTTP: unknown assets and inherited object keys return 404', async () => {
  for (const symbol of ['UNKNOWN', '__proto__', 'constructor']) assert.equal((await fetch(`${url}/v1/protocols/atlas/prices/${symbol}`)).status, 404);
});
test('HTTP: malformed, oversized and unsupported phase requests fail', async () => {
  assert.equal((await phase('unknown')).status, 400);
  for (const body of ['{broken', 'x'.repeat(1025)]) assert.equal((await fetch(`${url}/control/state`, { method: 'POST', body })).status, 400);
});
