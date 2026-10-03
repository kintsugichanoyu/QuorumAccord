import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { decodeAllocation, decodeFeed, DEVNET_GENESIS, DISCRIMINATORS, FEEDS, PROGRAM, readDevnet, rpcRead, usd, type Account } from '../ui/model.ts';

function account(kind: keyof typeof DISCRIMINATORS, length: number) {
  const bytes = new Uint8Array(length); bytes.set(DISCRIMINATORS[kind]);
  const data = new DataView(bytes.buffer);
  return { bytes, data, value: (): Account => ({ owner: PROGRAM, data: [Buffer.from(bytes).toString('base64'), 'base64'] }) };
}
function feed() {
  const a = account('DataFeed', 8248);
  a.data.setBigUint64(8, 1n, true); a.data.setBigUint64(16, 100n, true);
  a.data.setBigUint64(24, 198_250_000n, true); a.data.setUint32(32, 60, true);
  a.data.setUint16(46, 1, true); a.bytes[48] = 160; a.bytes[49] = 240;
  a.data.setBigUint64(56, 198_250_000n, true);
  return a;
}
test('browser account discriminators match the Anchor SHA-256 contract', () => {
  for (const [name, bytes] of Object.entries(DISCRIMINATORS))
    assert.deepEqual(bytes, [...createHash('sha256').update(`account:${name}`).digest().subarray(0, 8)]);
});
test('browser prices preserve the complete u64 range without floating-point conversion', () => {
  assert.equal(usd(198_250_000n), '$198.25');
  assert.equal(usd(0xffff_ffff_ffff_ffffn), '$18,446,744,073,709.551615');
  assert.equal(usd(1n), '$0.000001');
});
test('feed decoder checks freshness boundaries, future and unset readings', () => {
  const a = feed();
  assert.equal(decodeFeed(a.value(), FEEDS[0], 340n).status, 'fresh');
  assert.equal(decodeFeed(a.value(), FEEDS[0], 341n).status, 'stale');
  assert.equal(decodeFeed(a.value(), FEEDS[0], 99n).status, 'future');
  a.data.setBigUint64(8, 0n, true);
  assert.equal(decodeFeed(a.value(), FEEDS[0], 200n).status, 'unset');
});
test('feed decoder checks ownership, identity, truncation, ring bounds and header agreement', () => {
  const a = feed();
  assert.throws(() => decodeFeed({ ...a.value(), owner: 'wrong' }, FEEDS[0], 200n), /owner/);
  assert.throws(() => decodeFeed(a.value(), FEEDS[1], 200n), /identity/);
  assert.throws(() => decodeFeed(account('DataFeed', 80).value(), FEEDS[0], 200n), /Truncated/);
  a.data.setUint16(46, 256, true);
  assert.throws(() => decodeFeed(a.value(), FEEDS[0], 200n), /ring head/);
  a.data.setUint16(46, 1, true); a.data.setBigUint64(56, 123n, true);
  assert.throws(() => decodeFeed(a.value(), FEEDS[0], 200n), /mismatch/);
});
test('allocation decoder preserves excluded zeros and rejects invalid totals', () => {
  const a = account('AllocationState', 57);
  a.data.setBigUint64(8, 42n, true); a.data.setUint16(24, 5000, true); a.data.setUint16(26, 5000, true);
  assert.deepEqual(decodeAllocation(a.value()).weights, [5000, 5000, ...Array<number>(14).fill(0)]);
  a.data.setUint16(24, 5001, true);
  assert.throws(() => decodeAllocation(a.value()), /sum/);
});
test('frontend RPC rejects signing methods and non-HTTPS endpoints before network access', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('not called'); };
  await assert.rejects(rpcRead('https://example.com', 'sendTransaction', [], fetcher), /read-only/);
  await assert.rejects(rpcRead('http://example.com', 'getSlot', [], fetcher), /HTTPS/);
  assert.equal(calls, 0);
});
test('frontend verifies devnet genesis before reading accounts', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response(JSON.stringify({ result: 'wrong-network' })); };
  await assert.rejects(readDevnet('https://example.com', fetcher), /not Solana devnet/);
  assert.equal(calls, 1);
});
test('frontend consumes confirmed RPC context and propagates transport errors', async () => {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] }; methods.push(request.method);
    const result = request.method === 'getGenesisHash' ? DEVNET_GENESIS : request.method === 'getSlot' ? 200
      : { context: { slot: 201 }, value: [feed().value(), null, null, null] };
    return new Response(JSON.stringify({ result }));
  };
  const result = await readDevnet('https://example.com', fetcher);
  assert.equal(result.context, 201n); assert.equal(result.prices[0]!.view!.price, 198_250_000n);
  assert.equal(result.prices[1]!.view, null);
  assert.deepEqual(methods, ['getGenesisHash', 'getSlot', 'getMultipleAccounts']);
  await assert.rejects(readDevnet('https://example.com', async () => new Response('limited', { status: 429 })), /HTTP 429/);
});
test('mdBook navigation resolves every chapter and all named adapters disclose missing implementation', async () => {
  const source = resolve(import.meta.dirname, '../src');
  const summary = await readFile(resolve(source, 'SUMMARY.md'), 'utf8');
  const chapters = [...summary.matchAll(/\]\(([^)]+\.md)\)/g)].map(m => m[1]!);
  assert(chapters.length >= 15);
  for (const chapter of chapters) await access(resolve(source, chapter));
  for (const name of ['marginfi', 'kamino', 'save', 'jupiter', 'loopscale'])
    assert.match(await readFile(resolve(source, `protocols/${name}.md`), 'utf8'), /adapter not implemented/);
});
