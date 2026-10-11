import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { PolicyInstructions } from './policy-codec.mjs';
import { Instructions, discriminator, u64, decodeFeed, decodeSample, decodeRegistry, decodeAllocation } from '../../testing/devnet/dist/src/codec.js';
export { Instructions, decodeFeed, decodeSample, decodeRegistry, decodeAllocation };
export const ROOT = resolve(import.meta.dirname, '../..');
export const STATE = process.env.FLEET_STATE ?? join(import.meta.dirname, '.state');
export const ROLE = process.env.ROLE ?? 'setup';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export async function save(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, json(value) + '\n', { mode: 0o600 }); await rename(tmp, path);
}
export async function load(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch(e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function wallet(path) {
  const values = JSON.parse(await readFile(path, 'utf8'));
  assert(Array.isArray(values) && values.length === 64 && values.every(x => Number.isInteger(x) && x >= 0 && x <= 255), 'invalid wallet');
  return Keypair.fromSecretKey(Uint8Array.from(values));
}
export async function journal(event) {
  const entry = { at: new Date().toISOString(), role: ROLE, ...event };
  await mkdir(join(STATE, ROLE), { recursive: true, mode: 0o700 });
  await appendFile(join(STATE, ROLE, 'events.jsonl'), JSON.stringify(entry, (_,v)=>typeof v==='bigint'?v.toString():v)+'\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...entry, registry: entry.registry ? {pda:entry.registry.pda,decoded:entry.registry.decoded}:undefined,
    feeds: entry.feeds?.map(a=>({pda:a.pda,decoded:a.decoded})), allocation_state:entry.allocation_state?{pda:entry.allocation_state.pda,decoded:entry.allocation_state.decoded}:undefined,
    source: entry.source ? { context_slot: entry.source.context_slot, samples: entry.source.samples.map(({raw_base64,...s})=>s) } : undefined,
    account: entry.account ? { pda: entry.account.pda, context_slot: entry.account.context_slot, decoded: entry.account.decoded } : undefined }, (_,v)=>typeof v==='bigint'?v.toString():v));
}
export async function heartbeat(detail = {}) { await save(join(STATE, ROLE, 'health.json'), { at: Date.now(), role: ROLE, ...detail }); }
export async function client(url = process.env.RPC_URL, keyPath = process.env.KEYPAIR_FILE) {
  const config = await load(process.env.FLEET_CONFIG ?? join(STATE,'config.json'));
  assert(config?.program_id, 'missing fleet config');
  const connection = new Connection(url ?? config.rpc_url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS, 'refusing a non-devnet publication RPC');
  const key = keyPath ? await wallet(keyPath) : undefined;
  return { config, connection, key, ix: new PolicyInstructions(new PublicKey(config.program_id)) };
}
export function decodeRound(data) {
  assert(data.length >= 6464 && data.subarray(0,8).equals(discriminator('account','AllocationConsensus')), 'invalid AllocationConsensus');
  const count = data[28]; assert(count <= 100 && data[24] <= 2);
  return { round: data.readBigUInt64LE(8), closes: data.readBigUInt64LE(16), status: data[24], quorum: data[25], count,
    output: Array.from({length:16},(_,i)=>data.readUInt16LE(30+i*2)),
    submissions: Array.from({length:count},(_,i)=>({ operator: new PublicKey(data.subarray(62+i*64,94+i*64)).toBase58(), weights: Array.from({length:16},(_,j)=>data.readUInt16LE(94+i*64+j*2)) })) };
}
export async function account(c, pda, decode) {
  const r = await c.connection.getAccountInfoAndContext(pda);
  if (!r.value) return null;
  assert.equal(r.value.owner.toBase58(), c.config.program_id, 'PDA owner mismatch');
  return { pda: pda.toBase58(), context_slot: String(r.context.slot), owner: r.value.owner.toBase58(), lamports: r.value.lamports,
    raw_base64: r.value.data.toString('base64'), decoded: decode(r.value.data) };
}
export async function send(c, instructions, label) {
  assert(c.key, 'signer required');
  if (!Array.isArray(instructions)) instructions = [instructions];
  const latest = await c.connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: c.key.publicKey, ...latest }).add(...instructions); tx.sign(c.key);
  const signature = bs58.encode(tx.signature);
  await journal({ event: 'transaction_prepared', label, signature });
  let sendError;
  try { await c.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }); }
  catch(e) { sendError = e; }
  const deadline = Date.now() + (sendError ? 15000 : 120000);
  while (Date.now() < deadline) {
    const status = (await c.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`${label}: ${JSON.stringify(status.err)}`);
    if (status && ['confirmed','finalized'].includes(status.confirmationStatus)) {
      await journal({ event: 'transaction_confirmed', label, signature, slot: String(status.slot) }); return signature;
    }
    if (sendError) break;
    await pause(1500);
  }
  throw sendError ?? new Error(`confirmation timed out for ${label}: ${signature}`);
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({pubkey,isWritable,isSigner});
export function closeSample(c, pool, window) {
  return new TransactionInstruction({ programId:c.ix.program, keys:[meta(c.ix.feed(pool,0)),meta(c.ix.samplePda(pool,0,window),true),meta(c.key.publicKey,true,true)],
    data:Buffer.concat([discriminator('global','close_sample_consensus'),u64(window)]) });
}
export function closeRound(c, round) {
  return new TransactionInstruction({ programId:c.ix.program, keys:[meta(c.ix.registry()),meta(c.ix.allocationPda(round),true),meta(c.key.publicKey,true,true)],
    data:Buffer.concat([discriminator('global','close_allocation_consensus'),u64(round)]) });
}
