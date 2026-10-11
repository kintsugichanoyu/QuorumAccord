// Actual devnet lifecycle checks for the new rent-reclamation instructions.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Connection, Transaction } from '@solana/web3.js';
import { startRpcGateway } from '../../testing/devnet/dist/src/rpc-gateway.js';
import { STATE, client, wallet, send, account, journal, pause, decodeRound, closeRound, closeSample, decodeSample } from './common.mjs';

const config=JSON.parse(await (await import('node:fs/promises')).readFile(join(STATE,'config.json'),'utf8'));
const gateway=await startRpcGateway(config.rpc_url);
const c=await client(gateway.url,join(STATE,'keys','consumer.json'));
async function reject(signer, instruction, code, label) {
  const blockhash=await c.connection.getLatestBlockhash();
  const tx=new Transaction({feePayer:signer.publicKey,...blockhash}).add(instruction);tx.sign(signer);
  const result=await c.connection.simulateTransaction(tx);
  assert.deepEqual(result.value.err,{InstructionError:[0,{Custom:code}]});
  await journal({event:'devnet_negative_check',label,error:result.value.err,logs:result.value.logs});
}
try {
  const round=BigInt(await c.connection.getSlot());
  await send(c,c.ix.openAllocation(c.key.publicKey,round,round+80n,1,0),'rent test: open empty allocation round');
  await reject(c.key,closeRound(c,round),6008,'open allocation cannot be closed');
  const op=await wallet(join(STATE,'keys','oracle-1.json'));
  const other={...c,key:op};
  await reject(op,closeRound(other,round),6000,'non-admin cannot reclaim allocation rent');
  const state=(await account(c,c.ix.allocationPda(round),decodeRound)).decoded;
  while(BigInt(await c.connection.getSlot())<state.closes) await pause(2000);
  await send(c,c.ix.finalizeAllocation(c.key.publicKey,round),'rent test: close below-quorum round');
  const archived=await account(c,c.ix.allocationPda(round),decodeRound);assert.equal(archived.decoded.status,1);
  await journal({event:'test_allocation_archived',account:archived});
  const before=await c.connection.getBalance(c.key.publicKey);
  const signature=await send(c,closeRound(c,round),'rent test: reclaim closed allocation');
  assert.equal(await c.connection.getAccountInfo(c.ix.allocationPda(round)),null);
  const after=await c.connection.getBalance(c.key.publicKey);
  assert.equal(after-before,archived.lamports-5000);
  await journal({event:'rent_lifecycle_verified',signature,returned_lamports:after-before,account_closed:true});
  // Start a real APY sample; the fleet will corroborate and finalize it.
  const {readSources}=await import('./sources.mjs');const source=await readSources(config.source_rpc_url);
  const s=BigInt(await c.connection.getSlot()), window=s/BigInt(config.window_slots);
  if((window+1n)*BigInt(config.window_slots)-s>=80n) {
    const f=config.feeds[0];
    if(!await account(c,c.ix.samplePda(f.pool_id,0,window),decodeSample)) {
      await send(other,c.ix.sample('propose_sample',op.publicKey,f.pool_id,0,window,BigInt(source.samples[0].apy_bps),s),'rent test: propose live Marginfi APY');
      await reject(op,closeSample(other,f.pool_id,window),6008,'open sample cannot be closed');
    }
  }
} finally {await gateway.close();}
