import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { decodeAllocation, decodeFeed, decodeRegistry, decodeSample, discriminator, encodeConfig, Instructions, u64 } from '../../src/codec.js';
import { fixtureWeights, GOLDEN, VENUES } from '../../src/allocation.js';

const program = new PublicKey('DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz');
const admin = Keypair.generate().publicKey;
const ix = new Instructions(program);
function feed() { const data = Buffer.alloc(56 + 256 * 32); discriminator('account', 'DataFeed').copy(data); return data; }
test('wire format: u64 bounds and little-endian byte order', () => {
  assert.equal(u64(0x123456789abcdef0n).toString('hex'), 'f0debc9a78563412');
  assert.throws(() => u64(-1n));
  assert.throws(() => u64(1n << 64n));
});
test('wire format: config layout matches the 18-byte Borsh struct', () => {
  const bytes = encodeConfig({ measurand: 0, window_slots: 120, threshold_bps: 50, min_interval_slots: 0, max_interval_slots: 120, min_number: 3, rule: 1, trim_pct: 0 });
  assert.equal(bytes.length, 18);
  assert.equal(bytes.readUInt32LE(1), 120);
  assert.equal(bytes.readUInt16LE(5), 50);
  assert.deepEqual([...bytes.subarray(15)], [3, 1, 0]);
});
test('wire format: registry bootstrap accounts include program and ProgramData', () => {
  const instruction = ix.initRegistry(admin);
  assert.equal(instruction.keys.length, 5);
  assert(instruction.keys[2]!.pubkey.equals(SystemProgram.programId));
  assert(instruction.keys[3]!.pubkey.equals(program));
  assert(instruction.keys[1]!.isSigner);
});
test('wire format: sample args and PDA seeds match the deployed feed fixture', () => {
  assert.equal(ix.feed(160, 240).toBase58(), '878XKJFyNadaYQgZ2nfG7nT9pMkvmpbLgAagvFghsegd');
  const instruction = ix.sample('propose_sample', admin, 160, 240, 7n, 198250000n, 430n);
  assert.equal(instruction.data.length, 32);
  assert.equal(instruction.data.readBigUInt64LE(8), 7n);
  assert.equal(instruction.data.readBigUInt64LE(16), 198250000n);
  assert.equal(instruction.keys.length, 5);
});
test('feed decoder rejects truncation, wrong type and invalid ring head', () => {
  const data = feed();
  assert.equal(decodeFeed(data).tick, 0n);
  assert.throws(() => decodeFeed(data.subarray(0, -1)));
  data[0] = data[0]! ^ 1;
  assert.throws(() => decodeFeed(data));
  data[0] = data[0]! ^ 1;
  data.writeUInt16LE(256, 46);
  assert.throws(() => decodeFeed(data));
});
test('feed decoder reads the latest sample after ring wraparound', () => {
  const data = feed();
  data.writeBigUInt64LE(256n, 8);
  data.writeBigUInt64LE(12345n, 56 + 255 * 32);
  assert.equal(decodeFeed(data).price, 12345n);
});
test('allocation decoder validates its discriminator and full vector', () => {
  const data = Buffer.alloc(57);
  assert.throws(() => decodeAllocation(data));
  discriminator('account', 'AllocationState').copy(data);
  data.writeUInt16LE(5000, 24);
  data.writeUInt16LE(5000, 26);
  assert.deepEqual(decodeAllocation(data).weights, [5000, 5000, ...Array<number>(14).fill(0)]);
  assert.throws(() => decodeAllocation(data.subarray(0, 56)));
});
test('consensus decoder rejects malformed counts and truncated submissions', () => {
  const data = Buffer.alloc(4072);
  discriminator('account', 'DataFeedConsensus').copy(data);
  assert.equal(decodeSample(data).count, 0);
  data[68] = 101;
  assert.throws(() => decodeSample(data));
  assert.throws(() => decodeSample(data.subarray(0, 100)));
});
test('registry decoder rejects malformed membership count', () => {
  const data = Buffer.alloc(2092);
  discriminator('account', 'OperatorRegistry').copy(data);
  assert.deepEqual(decodeRegistry(data), []);
  data.writeUInt16LE(65, 40);
  assert.throws(() => decodeRegistry(data));
});
test('fixture allocation model independently reproduces the golden vector', () => {
  assert.deepEqual([...fixtureWeights(VENUES.map(([, apy, crr]) => ({ apy, crr }))), ...Array<number>(11).fill(0)], GOLDEN);
  assert.deepEqual(fixtureWeights([{ apy: 500n, crr: 6000n }]), [0]);
});
