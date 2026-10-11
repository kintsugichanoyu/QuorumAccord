import assert from 'node:assert/strict';
import {client,ROLE,send,account,journal,heartbeat,pause,decodeRound} from './common.mjs';
import {decodePolicy,decodeContext} from './policy-codec.mjs';
import {computeSnapshot} from './policy-math.mjs';
const c=await client(),self=c.config.consumers.find(p=>p.role===ROLE);
assert(self&&self.key===c.key.publicKey.toBase58(),'consumer role/key mismatch');
let noted='',submitted='';
await journal({event:'consumer_started',operator:self.key,allocation_quorum:3});
while(true){
 try{
  const policyAccount=await account(c,c.ix.policy(),decodePolicy),policy=policyAccount.decoded,round=policy.active_round,slot=BigInt(policyAccount.context_slot);
  if(round>0n&&submitted!==String(round)){
   const response=await c.connection.getMultipleAccountsInfoAndContext([c.ix.allocationPda(round),c.ix.context(round)]);
   const decoded=response.value.map((a,i)=>{if(!a)return null;assert.equal(a.owner.toBase58(),c.config.program_id);return {decoded:(i===0?decodeRound:decodeContext)(a.data)};});
   const [state,snapshot]=decoded;
   if(state?.decoded.submissions.some(s=>s.operator===self.key))submitted=String(round);
   if(state?.decoded.status===0&&snapshot&&slot<state.decoded.closes&&!state.decoded.submissions.some(s=>s.operator===self.key)){
    const {inputs,weights}=computeSnapshot(snapshot.decoded);
    if(noted!==String(round)){await journal({event:weights?'allocation_computed':'allocation_abstained',round,input_hash:Buffer.from(snapshot.decoded.input_hash).toString('hex'),anchor_slot:snapshot.decoded.anchor_slot,inputs,weights,reason:weights?undefined:'insufficient eligible capacity under frozen venue/category caps'});noted=String(round);}
    if(weights){await send(c,c.ix.submitV2(c.key.publicKey,round,weights,snapshot.decoded.input_hash),`submit allocation ${round} with frozen input hash`);submitted=String(round);}
   }
  }
  await heartbeat({slot:String(slot),active_round:String(round),operator:self.key});
 }catch(e){await journal({event:'iteration_error',message:e.message});}
 await pause(Number(process.env.POLL_MS??6000));
}
