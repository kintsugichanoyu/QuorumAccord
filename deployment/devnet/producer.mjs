import assert from 'node:assert/strict';
import {join} from 'node:path';
import {client,STATE,ROLE,load,save,send,account,journal,heartbeat,pause,decodeSample,closeSample} from './common.mjs';
import {readSources} from './sources.mjs';
const c=await client(),self=c.config.producers.find(p=>p.role===ROLE);
assert(self&&self.key===c.key.publicKey.toBase58(),'producer role/key mismatch');
const feed=c.config.feeds[self.venue],width=BigInt(feed.window_slots),pendingPath=join(STATE,ROLE,'pending.json');
let pending=await load(pendingPath,[]);
let submittedWindow='';
const first=BigInt(await c.connection.getSlot())/width;
for(let d=1n;d<=3n&&first>=d;d++)if(!pending.includes(String(first-d)))pending.push(String(first-d));
const state=window=>account(c,c.ix.samplePda(feed.pool_id,0,window),decodeSample);
await journal({event:'producer_started',operator:self.key,venue:feed.name,window_slots:feed.window_slots,quorum:3});
while(true){
 try{
  const slot=BigInt(await c.connection.getSlot());
  for(const previous of [...pending]){
   const w=BigInt(previous);if((w+1n)*width>slot)continue;
   let s=await state(w);
   if(s?.decoded.status===0){
    try{await send(c,c.ix.finalizeSample(c.key.publicKey,feed.pool_id,0,w),`finalize ${feed.name} window=${w}`);}
    catch(e){s=await state(w);if(s?.decoded.status===0){await journal({event:'finalize_retry',message:e.message});continue;}}
    s=await state(w);
   }
   if(s&&s.decoded.status!==0&&s.decoded.submissions[0]?.operator===self.key){await journal({event:'sample_consensus_archived',venue:feed.name,account:s});await send(c,closeSample(c,feed.pool_id,w),`reclaim ${feed.name} sample rent window=${w}`);}
   pending=pending.filter(p=>p!==previous);await save(pendingPath,pending);
  }
  const current=pending.length?BigInt(await c.connection.getSlot()):slot,active=current/width;
  if(String(active)!==submittedWindow&&(active+1n)*width-current>=30n){
   let s=await state(active);
   if(s?.decoded.submissions.some(v=>v.operator===self.key)){
    submittedWindow=String(active);
    if(!pending.includes(String(active))){pending.push(String(active));await save(pendingPath,pending);}
   }
   // One designated opener avoids three competing account-creation transactions.
   // Every operator still fetches and signs its own observation.
   if(!s&&self.operator!==1){await heartbeat({slot:String(current),venue:feed.name,operator:self.key});await pause(3000);continue;}
   if(!s?.decoded.submissions.some(v=>v.operator===self.key)&&(!s||s.decoded.status===0)){
    const source=await readSources(c.config.source_rpc_url,self.venue);
    // Explicit, journaled devnet fault injection, controlled only from the local host.
    const control=await load(`/control/${ROLE}.json`,{});
    let value=BigInt(source.samples[0].apy_bps);
    if(control.outlier_bps!==undefined){assert(Number.isInteger(control.outlier_bps)&&control.outlier_bps>=0&&control.outlier_bps<=1000000);value=BigInt(control.outlier_bps);await journal({event:'fault_injected',kind:'producer_outlier',actual_apy_bps:source.samples[0].apy_bps,submitted_apy_bps:value,window:active});}
    await journal({event:'source_fetch',window:active,source});
    for(let attempt=0;attempt<4;attempt++){
     const read=BigInt(await c.connection.getSlot());if(read/width!==active||s?.decoded.submissions.some(v=>v.operator===self.key))break;
     try{await send(c,c.ix.sample(s?'corroborate_sample':'propose_sample',c.key.publicKey,feed.pool_id,0,active,value,read),`${feed.name} APY ${value}bps window=${active}`);submittedWindow=String(active);if(!pending.includes(String(active)))pending.push(String(active));await save(pendingPath,pending);break;}
     catch(e){await journal({event:'creation_race_retry',message:e.message});await pause(700);s=await state(active);}
    }
   }
  }
  await heartbeat({slot:String(current),venue:feed.name,operator:self.key});
 }catch(e){await journal({event:'iteration_error',message:e.message});}
 await pause(Number(process.env.POLL_MS??9000));
}
