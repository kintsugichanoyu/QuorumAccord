import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDelay, startRpcGateway } from '../../src/rpc-gateway.js';

test('RPC pacing honours Retry-After seconds, dates and bounded backoff', () => {
  assert.equal(retryDelay('3', 0, 1000), 3000);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:05 GMT', 0, 1000, 1000), 4000);
  assert.equal(retryDelay(null, 2, 1000), 4000);
  assert.equal(retryDelay('invalid', 0, 1000), 1000);
  assert.equal(retryDelay('900', 0, 1000), 30_000);
});
test('RPC gateway serializes requests and preserves signed bytes and chain responses', async () => {
  const observed: { body: string; at: number }[] = [];
  const gateway = await startRpcGateway('https://unused.example', { intervalMs: 20, methodIntervalMs: 30,
    fetch: async (_url, init) => {
      observed.push({ body: String(init?.body), at: Date.now() });
      return new Response('{"jsonrpc":"2.0","result":"real-response","id":1}', { status: 200 });
    },
  });
  try {
    const body = '{"jsonrpc":"2.0","method":"sendTransaction","params":["signed-bytes"],"id":1}';
    const replies = await Promise.all([0, 1, 2].map(async () => (await fetch(gateway.url, { method: 'POST', body })).text()));
    assert(replies.every(r => r.includes('real-response')));
    assert(observed.every(r => r.body === body));
    assert(observed[1]!.at - observed[0]!.at >= 25);
    assert(observed[2]!.at - observed[1]!.at >= 25);
    assert.equal(gateway.stats.requests, 3);
  } finally { await gateway.close(); }
});
test('RPC gateway retries throttling without changing the transaction payload', async () => {
  const bodies: string[] = [];
  const gateway = await startRpcGateway('https://unused.example', { intervalMs: 0, methodIntervalMs: 0, retryBaseMs: 1,
    fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      return bodies.length === 1 ? new Response('limited', { status: 429, headers: { 'retry-after': '0' } })
        : new Response('{"result":123}', { status: 200 });
    },
  });
  try {
    const body = '{"jsonrpc":"2.0","method":"getSlot","id":1}';
    const response = await fetch(gateway.url, { method: 'POST', body });
    assert.equal(response.status, 200);
    assert.deepEqual(bodies, [body, body]);
    assert.equal(gateway.stats.rate_limit_retries, 1);
  } finally { await gateway.close(); }
});
test('RPC gateway exposes persistent upstream failures and rejects invalid requests', async () => {
  const gateway = await startRpcGateway('https://unused.example', { intervalMs: 0, methodIntervalMs: 0, retries: 0,
    fetch: async () => new Response('still limited', { status: 429 }),
  });
  try {
    assert.equal((await fetch(gateway.url)).status, 405);
    assert.equal((await fetch(gateway.url, { method: 'POST', body: '{}' })).status, 400);
    const response = await fetch(gateway.url, { method: 'POST', body: '{"jsonrpc":"2.0","method":"getSlot"}' });
    assert.equal(response.status, 429);
    assert.equal(await response.text(), 'still limited');
  } finally { await gateway.close(); }
});
