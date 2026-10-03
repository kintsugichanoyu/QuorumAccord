import assert from 'node:assert/strict';
import test from 'node:test';
import { fresh } from '../../src/consumer.js';
import { json, loopback, uint64, validateQuote, type Quote } from '../../src/types.js';

const quote: Quote = { test_only: true, protocol: 'atlas', symbol: 'SOL', price_micro_usd: '198250000', decimals: 6, phase: 'baseline', observed_at_ms: 100_000 };
test('quote: correct identity, fixed-point units and timestamp', () => assert.equal(validateQuote(quote, 'atlas', 'SOL', 100_010), 198250000n));
test('quote: wrong protocol and symbol are rejected', () => {
  assert.throws(() => validateQuote(quote, 'boreal', 'SOL', 100_010));
  assert.throws(() => validateQuote(quote, 'atlas', 'BTC', 100_010));
});
test('quote: stale and future observations are rejected', () => {
  assert.throws(() => validateQuote(quote, 'atlas', 'SOL', 140_000));
  assert.throws(() => validateQuote(quote, 'atlas', 'SOL', 1));
});
test('quote: zero values, wrong units and unmarked mock data are rejected', () => {
  for (const bad of [{ ...quote, price_micro_usd: '0' }, { ...quote, decimals: 9 }, { ...quote, test_only: false }])
    assert.throws(() => validateQuote(bad, 'atlas', 'SOL', 100_010));
});
test('u64: full range remains exact in JSON', () => {
  const maximum = 0xffff_ffff_ffff_ffffn;
  assert.equal(uint64(maximum.toString()), maximum);
  assert.equal(JSON.parse(json({ value: maximum })).value, maximum.toString());
});
test('u64: imprecise numbers and noncanonical/out-of-range strings are rejected', () => {
  for (const bad of [Number.MAX_SAFE_INTEGER + 1, '01', '-1', '1.5', '18446744073709551616']) assert.throws(() => uint64(bad));
});
test('consumer freshness: exact boundary, unset and future slots', () => {
  assert(fresh(100n, 120n, 20n));
  assert(!fresh(100n, 121n, 20n));
  assert(!fresh(0n, 1n, 20n));
  assert(!fresh(100n, 99n, 20n));
});
test('loopback checks parse real hostnames and reject credential tricks', () => {
  assert(loopback('http://127.0.0.1:18787'));
  assert(!loopback('http://127.0.0.1:80@evil.example'));
  assert(!loopback('http://127.0.0.1.evil.example'));
  assert(!loopback('https://localhost'));
});
