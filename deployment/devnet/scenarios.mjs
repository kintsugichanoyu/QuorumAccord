import assert from 'node:assert/strict';
import {readFile,unlink,chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {client,STATE,ROOT,load,save,pause,account,decodeAllocation,decodeFeed,decodeSample} from './common.mjs';
import {decodeContext} from './policy-codec.mjs';
const c=await client('http://127.0.0.1:18789'),run=promisify(execFile),results=[];
const compose=async(action,...services)=>run('sudo',['-n','docker',action,...services.map(s=>`quorum-devnet-${s}-1`)]);
const runStarted=new Date().toISOString();
const roles=['coordinator',...c.config.producers.map(p=>p.role),...c.config.consumers.map(p=>p.role)];
async function events(){const es=[];for(const role of roles){try{for await(const line of createInterface({input:createReadStream(join(STATE,'runtime',role,'events.jsonl')),crlfDelay:Infinity})){if(line){const e=JSON.parse(line);if(e.at>=runStarted)es.push(e);}}}catch(e){if(e.code!=='ENOENT')throw e;}}return es.sort((a,b)=>a.at.localeCompare(b.at));}
async function waitFor(label,check,timeout=360000){const until=Date.now()+timeout;while(Date.now()<until){try{const found=await check();if(found)return found;}catch(e){if(!/fetch failed|ECONNRESET|502|503|429|socket/i.test(e.message))throw e;console.log('Transient RPC retry:',e.message);}await pause(8000);}throw Error(`Timed out: ${label}`);}
const allocation=async()=>(await account(c,c.ix.allocationState(),decodeAllocation)).decoded;
function signatures(es,round){return es.filter(e=>e.event==='transaction_confirmed'&&e.label?.includes(String(round))).map(e=>e.signature);}
async function record(result){results.push({...result,network:'devnet',finished_at:new Date().toISOString(),passed:true});const data={finished_at:new Date().toISOString(),scenarios:results};for(const path of [join(import.meta.dirname,'evidence/v2/scenarios.json'),join(ROOT,'demo-site/dist/scenarios.json')]){await save(path,data);await chmod(path,0o644);}console.log('VERIFIED',result.title);}
const marginfi=c.config.producers.filter(p=>p.venue===0).map(p=>p.role),faultPath=join(STATE,'control','producer-marginfi-1.json');
try{
 await waitFor('initial three-consumer publication',async()=>{const a=await allocation(),ctx=await account(c,c.ix.context(a.round),decodeContext);return ctx?.decoded.outcome===1&&ctx.decoded.eligible.slice(0,3).every(Boolean);},600000);
 let started=new Date().toISOString();await save(faultPath,{outlier_bps:999999,reason:'explicit devnet median resilience demonstration'});
 const outlier=await waitFor('outlier included in finalized median',async()=>{const es=await events();for(const e of es.filter(e=>e.at>=started&&e.event==='sample_consensus_archived'&&e.venue==='Marginfi')){const s=decodeSample(Buffer.from(e.account.raw_base64,'base64'));if(s.status===2&&s.submissions.some(v=>v.value===999999n)){const sorted=s.submissions.map(v=>v.value).sort((a,b)=>a<b?-1:a>b?1:0);assert.equal(s.output,sorted[1]);assert.notEqual(s.output,999999n);return {event:e,decoded:s,signatures:signatures(es,`window=${s.window}`)};}}});
 await unlink(faultPath);
 await record({title:'One extreme producer cannot move the median',outcome:`Injected 999,999 bps into one Marginfi producer. Three signed reports finalized to ${outlier.decoded.output} bps, the median of the reports.`,injected_bps:999999,consensus:outlier.decoded,account:outlier.event.account.pda,signatures:outlier.signatures});
 started=new Date().toISOString();await compose('stop','consumer-3');
 const lost=await waitFor('consumer quorum loss closes without publication',async()=>{const es=await events();const e=es.find(e=>e.at>=started&&e.event==='allocation_round_finished'&&e.snapshot?.decoded.outcome===2&&e.account.decoded.count===2);return e&&{event:e,signatures:signatures(es,e.account.decoded.round)};});
 assert.notEqual(lost.event.allocation_state.decoded.round,lost.event.account.decoded.round);
 await record({title:'Losing one consumer prevents publication',outcome:'With consumer-3 stopped, a round collected two votes and closed with no quorum. AllocationState retained an earlier published round.',round:lost.event.account.decoded.round,retained_round:lost.event.allocation_state.decoded.round,consensus:lost.event.account.decoded,snapshot:lost.event.snapshot.decoded,signatures:lost.signatures});
 await compose('start','consumer-3');started=new Date().toISOString();
 const recovered=await waitFor('consumer restart restores publications',async()=>{const es=await events();const e=es.find(e=>e.at>=started&&e.event==='allocation_round_finished'&&e.snapshot?.decoded.outcome===1&&e.account.decoded.count===3);return e&&{event:e,signatures:signatures(es,e.account.decoded.round)};});
 assert.equal(new Set(recovered.event.account.decoded.submissions.map(s=>s.operator)).size,3);
 await record({title:'Restart recovers from on-chain round state',outcome:'The restarted consumer resumed with its existing wallet, read the active snapshot, and restored a three-signature publication with no duplicate operator votes.',round:recovered.event.account.decoded.round,consensus:recovered.event.account.decoded,signatures:recovered.signatures});
 await compose('stop',...marginfi);started=new Date().toISOString();
 const stale=await waitFor('stale Marginfi causes safe abstention',async()=>{const es=await events();const e=es.find(e=>e.at>=started&&e.event==='allocation_round_finished'&&e.snapshot?.decoded.eligible[0]===0&&e.snapshot.decoded.ticks[0]!=='0'&&e.account.decoded.count===0);return e&&{event:e,signatures:signatures(es,e.account.decoded.round)};},480000);
 assert.equal(stale.event.snapshot.decoded.outcome,2);assert.notEqual(stale.event.allocation_state.decoded.round,stale.event.account.decoded.round);
 await record({title:'Stale inputs do not force an invalid allocation',outcome:'After all Marginfi producers stopped, its feed exceeded the configured freshness limit. Save and Kamino share a 75% category cap, so every consumer abstained. The round closed and the previous allocation was retained.',snapshot:stale.event.snapshot.decoded,retained_allocation:stale.event.allocation_state.decoded,consensus:stale.event.account.decoded,signatures:stale.signatures});
 await compose('start',...marginfi);started=new Date().toISOString();
 const fresh=await waitFor('feed and allocation recovery',async()=>{const es=await events();const e=es.find(e=>e.at>=started&&e.event==='allocation_round_finished'&&e.snapshot?.decoded.outcome===1&&e.snapshot.decoded.eligible.slice(0,3).every(Boolean));return e&&{event:e,signatures:signatures(es,e.account.decoded.round)};},600000);
 await record({title:'The full pipeline resumes after feed recovery',outcome:'All producers resumed from persistent state, refreshed the independent feeds, and three consumers published a valid allocation with all inputs eligible.',round:fresh.event.account.decoded.round,weights:fresh.event.allocation_state.decoded.weights,signatures:fresh.signatures});
}finally{await unlink(faultPath).catch(e=>{if(e.code!=='ENOENT')throw e;});await compose('start','consumer-3',...marginfi);}
