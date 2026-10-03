import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import { uint64 } from './types.js';

export function discriminator(namespace: 'global' | 'account', name: string): Buffer {
  return createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8);
}
export function u64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(uint64(value)); return bytes;
}
function u32(value: number): Buffer { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; }
function u16(value: number): Buffer { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; }
function meta(pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta { return { pubkey, isWritable, isSigner }; }
export interface FeedConfig {
  window_slots: number; threshold_bps: number; min_interval_slots: number;
  max_interval_slots: number; min_number: number; rule: number; trim_pct: number; measurand: number;
}
export function encodeConfig(config: FeedConfig): Buffer {
  return Buffer.concat([Buffer.from([config.measurand]), u32(config.window_slots), u16(config.threshold_bps),
    u32(config.min_interval_slots), u32(config.max_interval_slots), Buffer.from([config.min_number, config.rule, config.trim_pct])]);
}

export class Instructions {
  constructor(readonly program: PublicKey) {}
  pda(...seeds: Buffer[]): PublicKey { return PublicKey.findProgramAddressSync(seeds, this.program)[0]; }
  registry(): PublicKey { return this.pda(Buffer.from('registry')); }
  feed(pool: number, data: number): PublicKey { return this.pda(Buffer.from('data_feed'), Buffer.from([pool]), Buffer.from([data])); }
  samplePda(pool: number, data: number, window: bigint): PublicKey {
    return this.pda(Buffer.from('tick_consensus'), this.feed(pool, data).toBuffer(), u64(window));
  }
  allocationPda(round: bigint): PublicKey { return this.pda(Buffer.from('consensus'), u64(round)); }
  allocationState(): PublicKey { return this.pda(Buffer.from('allocation_state')); }
  private ix(name: string, keys: AccountMeta[], ...args: Buffer[]): TransactionInstruction {
    return new TransactionInstruction({ programId: this.program, keys, data: Buffer.concat([discriminator('global', name), ...args]) });
  }
  initRegistry(admin: PublicKey): TransactionInstruction {
    const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
    const programData = PublicKey.findProgramAddressSync([this.program.toBuffer()], loader)[0];
    return this.ix('init_registry', [meta(this.registry(), true), meta(admin, true, true), meta(SystemProgram.programId), meta(this.program), meta(programData)]);
  }
  addOperator(admin: PublicKey, operator: PublicKey): TransactionInstruction {
    return this.ix('add_operator', [meta(this.registry(), true), meta(admin, false, true)], operator.toBuffer());
  }
  initFeed(admin: PublicKey, pool: number, data: number, config: FeedConfig): TransactionInstruction {
    return this.ix('init_data_feed', [meta(this.registry()), meta(this.feed(pool, data), true), meta(admin, true, true), meta(SystemProgram.programId)],
      Buffer.from([pool, data]), encodeConfig(config));
  }
  updateFeed(admin: PublicKey, pool: number, data: number, config: FeedConfig): TransactionInstruction {
    return this.ix('update_thresholds', [meta(this.registry()), meta(this.feed(pool, data), true), meta(admin, false, true)], encodeConfig(config));
  }
  sample(kind: 'propose_sample' | 'corroborate_sample', operator: PublicKey, pool: number, data: number,
    window: bigint, value: bigint, readSlot: bigint): TransactionInstruction {
    const keys = [meta(this.registry()), meta(this.feed(pool, data)), meta(this.samplePda(pool, data, window), true), meta(operator, kind === 'propose_sample', true)];
    if (kind === 'propose_sample') keys.push(meta(SystemProgram.programId));
    return this.ix(kind, keys, u64(window), u64(value), u64(readSlot));
  }
  finalizeSample(cranker: PublicKey, pool: number, data: number, window: bigint): TransactionInstruction {
    return this.ix('finalize_sample', [meta(this.feed(pool, data), true), meta(this.samplePda(pool, data, window), true), meta(cranker, false, true)], u64(window));
  }
  initAllocation(admin: PublicKey): TransactionInstruction {
    return this.ix('init_allocation_state', [meta(this.registry()), meta(this.allocationState(), true), meta(admin, true, true), meta(SystemProgram.programId)]);
  }
  openAllocation(admin: PublicKey, round: bigint, closes: bigint, quorum = 2, rule = 0): TransactionInstruction {
    return this.ix('open_allocation_round', [meta(this.registry()), meta(this.allocationPda(round), true), meta(admin, true, true), meta(SystemProgram.programId)],
      u64(round), u64(closes), Buffer.from([quorum, rule, 0]));
  }
  submitWeights(operator: PublicKey, round: bigint, weights: number[]): TransactionInstruction {
    assert.equal(weights.length, 16);
    return this.ix('submit_weights', [meta(this.registry()), meta(this.allocationPda(round), true), meta(operator, false, true)], u64(round), Buffer.concat(weights.map(u16)));
  }
  finalizeAllocation(cranker: PublicKey, round: bigint): TransactionInstruction {
    return this.ix('finalize_allocation', [meta(this.allocationPda(round), true), meta(this.allocationState(), true), meta(cranker, false, true)], u64(round));
  }
  mock(id: number): PublicKey { return this.pda(Buffer.from('mock'), Buffer.from([id])); }
  initMock(admin: PublicKey, id: number): TransactionInstruction {
    return this.ix('init_mock', [meta(this.mock(id), true), meta(admin, true, true), meta(SystemProgram.programId)], Buffer.from([id]));
  }
  writeMock(admin: PublicKey, id: number, value: bigint): TransactionInstruction {
    return this.ix('write_u64', [meta(this.mock(id), true), meta(admin, false, true)], Buffer.from([id, 0]), u64(value));
  }
}

function accountType(data: Buffer, name: string, minimum: number) {
  assert(data.length >= minimum, `${name} account truncated`);
  assert(data.subarray(0, 8).equals(discriminator('account', name)), `wrong ${name} discriminator`);
}
export function decodeFeed(data: Buffer) {
  accountType(data, 'DataFeed', 56 + 256 * 32);
  const head = data.readUInt16LE(46);
  assert(head < 256, 'invalid ring head');
  const tick = data.readBigUInt64LE(8);
  const latest = 56 + ((head + 255) % 256) * 32;
  return { tick, last_finalized_slot: data.readBigUInt64LE(16), last_value: data.readBigUInt64LE(24),
    window_slots: data.readUInt32LE(32), head, pool_id: data[48]!, data_id: data[49]!,
    price: tick === 0n ? 0n : data.readBigUInt64LE(latest) };
}
export function decodeSample(data: Buffer) {
  accountType(data, 'DataFeedConsensus', 72 + 100 * 40);
  const count = data[68]!;
  assert(count <= 100, 'invalid sample count');
  assert(data[64]! <= 2, 'invalid sample status');
  return { window: data.readBigUInt64LE(8), closes: data.readBigUInt64LE(16), status: data[64]!, count,
    submissions: Array.from({ length: count }, (_, i) => ({ value: data.readBigUInt64LE(72 + i * 40), operator: new PublicKey(data.subarray(80 + i * 40, 112 + i * 40)).toBase58() })) };
}
export function decodeRegistry(data: Buffer): string[] {
  accountType(data, 'OperatorRegistry', 44 + 64 * 32);
  const count = data.readUInt16LE(40);
  assert(count <= 64, 'invalid registry count');
  return Array.from({ length: count }, (_, i) => new PublicKey(data.subarray(44 + i * 32, 76 + i * 32)).toBase58());
}
export function decodeAllocation(data: Buffer) {
  accountType(data, 'AllocationState', 57);
  return { round: data.readBigUInt64LE(8), updated_slot: data.readBigUInt64LE(16), weights: Array.from({ length: 16 }, (_, i) => data.readUInt16LE(24 + i * 2)) };
}
export function decodeMock(data: Buffer): bigint {
  accountType(data, 'MockData', 105);
  return data.readBigUInt64LE(8);
}
