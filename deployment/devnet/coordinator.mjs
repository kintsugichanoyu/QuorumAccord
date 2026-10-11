import assert from 'node:assert/strict';
import {join} from 'node:path';
import {client,STATE,ROLE,load,save,send,account,journal,heartbeat,pause,decodeFeed,decodeAllocation,decodeRound} from './common.mjs';
import {decodePolicy,decodeContext} from './policy-codec.mjs';
import {discriminator} from '../../testing/devnet/dist/src/codec.js';
import bs58 from 'bs58';
const c=await client();assert.equal(c.key.publicKey.toBase58(),c.config.admin);
const pendingPath=join(STATE,ROLE,'pending.json');let pending=await load(pendingPath,[]),lastInput='',lastScan=0;
await journal({event:'coordinator_started',admin:c.config.admin});
while(true){
 try{
  let policy=(await account(c,c.ix.policy(),decodePolicy)).decoded;
  const slot=BigInt(await c.connection.getSlot());
  // Recover all v2 rounds from chain, even after loss of the local journal.
  if(Date.now()-lastScan>300000){
   const contexts=await c.connection.getProgramAccounts(c.ix.program,{filters:[{memcmp:{offset:0,bytes:bs58.encode(discriminator('account','RoundContext'))}}]});
   for(const a of contexts){const round=String(decodeContext(a.account.data).round);if(!pending.includes(round))pending.push(round);}
   lastScan=Date.now();await save(pendingPath,pending);
  }
  let activeOpen=false;
  for(const entry of [...pending]){
   const round=BigInt(entry);let consensus=await account(c,c.ix.allocationPda(round),decodeRound);
   if(!consensus){pending=pending.filter(x=>x!==entry);continue;}
   if(consensus.decoded.status===0&&slot>=consensus.decoded.closes){
    await send(c,c.ix.finalizeV2(c.key.publicKey,round),`finalize allocation ${round}`);
    consensus=await account(c,c.ix.allocationPda(round),decodeRound);
    const snapshot=await account(c,c.ix.context(round),decodeContext);
    await journal({event:'allocation_round_finished',account:consensus,snapshot,allocation_state:await account(c,c.ix.allocationState(),decodeAllocation)});
    policy=(await account(c,c.ix.policy(),decodePolicy)).decoded;
   }
   if(consensus.decoded.status===0){activeOpen=true;continue;}
   if(round!==policy.published_round){
    await journal({event:'allocation_consensus_archived',account:consensus,snapshot:await account(c,c.ix.context(round),decodeContext)});
    await send(c,c.ix.closeV2(c.key.publicKey,round),`reclaim allocation rent ${round}`);pending=pending.filter(x=>x!==entry);
   }
  }
  await save(pendingPath,pending);
  if(!activeOpen){
   const response=await c.connection.getMultipleAccountsInfoAndContext(c.config.feeds.map(f=>c.ix.feed(f.pool_id,0)));
   const feeds=response.value.map(a=>{assert(a&&a.owner.toBase58()===c.config.program_id);return decodeFeed(a.data);});
   const inputId=feeds.map((f,i)=>`${f.tick}:${BigInt(response.context.slot)-f.last_finalized_slot<=BigInt(c.config.feeds[i].stale_slots)}`).join('|')+`:${policy.version}`;
   if(feeds.some(f=>f.tick>0n)&&inputId!==lastInput){
    const now=BigInt(await c.connection.getSlot()),allocation=(await account(c,c.ix.allocationState(),decodeAllocation)).decoded;
    const round=[now,policy.active_round+1n,allocation.round+1n].reduce((a,b)=>a>b?a:b);
    await send(c,c.ix.openV2(c.key.publicKey,round,now+BigInt(c.config.round_vote_slots),c.config.feeds.map(f=>c.ix.feed(f.pool_id,0))),`freeze asynchronous feed heads for allocation ${round}`);
    pending.push(String(round));await save(pendingPath,pending);lastInput=inputId;
    await journal({event:'allocation_snapshot_frozen',account:await account(c,c.ix.context(round),decodeContext)});
   }
  }
  await heartbeat({slot:String(slot),pending_rounds:pending});
 }catch(e){await journal({event:'iteration_error',message:e.message});}
 await pause(Number(process.env.POLL_MS??6000));
}
