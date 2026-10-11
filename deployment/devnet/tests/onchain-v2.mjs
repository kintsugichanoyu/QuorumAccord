// Run against a fresh local validator preloaded with the current SBF program.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Connection,Keypair,PublicKey,Transaction,TransactionInstruction} from '@solana/web3.js';
import {PolicyInstructions,decodePolicy,decodeContext} from '../policy-codec.mjs';
import {decodeAllocation,decodeFeed,decodeSample,discriminator,u64} from '../../../testing/devnet/dist/src/codec.js';
import {computeSnapshot,validPolicyWeights} from '../policy-math.mjs';
const rpc=new Connection(process.env.TEST_RPC??'http://127.0.0.1:18899','confirmed');
const admin=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(process.env.TEST_ADMIN??'/tmp/quorum-v2-test/admin.json'))));
const ops=Array.from({length:4},()=>Keypair.generate());
const ix=new PolicyInstructions(new PublicKey('DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz'));
const pause=ms=>new Promise(r=>setTimeout(r,ms)),slot=async()=>BigInt(await rpc.getSlot());
const wait=async end=>{while(await slot()<end)await pause(100);};
const data=async key=>(await rpc.getAccountInfo(key)).data;
const results=[];const record=(name,detail={})=>{results.push({name,...detail});console.log('PASS',name);};
const pad=(xs,value=0)=>[...xs,...Array(16-xs.length).fill(value)];
async function send(key,...instructions){const bh=await rpc.getLatestBlockhash();const tx=new Transaction({feePayer:key.publicKey,...bh}).add(...instructions);tx.sign(key);const signature=await rpc.sendRawTransaction(tx.serialize(),{preflightCommitment:'confirmed',maxRetries:3});assert.equal((await rpc.confirmTransaction({...bh,signature},'confirmed')).value.err,null);return signature;}
async function reject(key,instruction,code){const tx=new Transaction({feePayer:key.publicKey,...await rpc.getLatestBlockhash()}).add(instruction);tx.sign(key);const res=await rpc._rpcRequest('simulateTransaction',[tx.serialize().toString('base64'),{encoding:'base64',commitment:'confirmed',replaceRecentBlockhash:true}]);assert.deepEqual(res.result.value.err,{InstructionError:[0,{Custom:code}]},JSON.stringify(res.result.value));}
for(const k of [admin,...ops]){const s=await rpc.requestAirdrop(k.publicKey,10e9);await rpc.confirmTransaction(s,'confirmed');}
await send(admin,ix.initRegistry(admin.publicKey),ix.initAllocation(admin.publicKey));
for(const k of ops)await send(admin,ix.addOperator(admin.publicKey,k.publicKey));
const base={measurand:0,window_slots:60,threshold_bps:1,min_interval_slots:0,max_interval_slots:60,min_number:1,rule:1,trim_pct:0};
for(let i=0;i<4;i++)await send(admin,ix.initFeed(admin.publicKey,30+i,0,{...base,window_slots:60+i*20,max_interval_slots:60+i*20}));
const pending=[];
for(let i=0;i<4;i++){
 const width=BigInt(60+i*20);let now=await slot();if((now/width+1n)*width-now<20n)await wait((now/width+1n)*width);
 now=await slot();const window=now/width;
 await send(ops[0],ix.sample('propose_sample',ops[0].publicKey,30+i,0,window,BigInt(200+i*100),now));pending.push({i,window,end:(window+1n)*width});
}
await wait(pending.reduce((a,x)=>a>x.end?a:x.end,0n));
for(const p of pending)await send(admin,ix.finalizeSample(admin.publicKey,30+p.i,0,p.window));
const feeds=Array.from({length:4},(_,i)=>ix.feed(30+i,0));
let cfg={feeds:pad(feeds.map(k=>k.toBase58()),PublicKey.default.toBase58()),max_stale_slots:pad([100000,100000,100000,100000]),risk_bps:pad([0,0,0,0]),caps_bps:pad([5000,5000,5000,5000]),categories:pad([0,0,0,0]),category_caps_bps:[10000,10000,10000,10000],risk_screen_bps:6000,min_consumers:3,max_round_slots:300,consumers:ops.slice(0,3).map(k=>k.publicKey.toBase58())};
await send(admin,ix.configure(admin.publicKey,cfg));
assert.equal(decodePolicy(await data(ix.policy())).version,1n);
await reject(admin,ix.openAllocation(admin.publicKey,1n,await slot()+100n,1,1),6020);record('legacy allocation cannot bypass policy');
let next=100n;
async function open(){const round=next++,end=await slot()+100n;await send(admin,ix.openV2(admin.publicKey,round,end,feeds));return {round,end,ctx:decodeContext(await data(ix.context(round)))};}
async function finish(r){await wait(r.end);const signature=await send(admin,ix.finalizeV2(admin.publicKey,r.round));return {ctx:decodeContext(await data(ix.context(r.round))),signature};}
async function close(round){await send(admin,ix.closeV2(admin.publicKey,round));assert.equal(await rpc.getAccountInfo(ix.context(round)),null);assert.equal(await rpc.getAccountInfo(ix.allocationPda(round)),null);}
let r=await open();
assert(new Set(r.ctx.sample_slots.slice(0,4).map(String)).size>1);record('atomic snapshot accepts independent feed cadences',{slots:r.ctx.sample_slots.slice(0,4)});
await reject(ops[0],ix.submitV2(ops[0].publicKey,r.round,pad([5000,5000]),Array(32).fill(0)),6022);
await reject(ops[3],ix.submitV2(ops[3].publicKey,r.round,pad([5000,5000]),r.ctx.input_hash),6023);
await reject(ops[0],ix.submitV2(ops[0].publicKey,r.round,pad([10000]),r.ctx.input_hash),6021);
record('wrong snapshot, unauthorized consumer and cap violation rejected');
for(let i=0;i<3;i++){const w=pad([5000]);w[i+1]=5000;await send(ops[i],ix.submitV2(ops[i].publicKey,r.round,w,r.ctx.input_hash));}
let f=await finish(r);assert.equal(f.ctx.outcome,4);assert.equal(decodeAllocation(await data(ix.allocationState())).updated_slot,0n);await close(r.round);record('concentrated median aborts safely and rent is reclaimable',f);
cfg={...cfg,caps_bps:pad([10000,10000,10000,10000])};await send(admin,ix.configure(admin.publicKey,cfg,true));
r=await open();for(let i=0;i<3;i++){const w=pad([]);w[i]=10000;await send(ops[i],ix.submitV2(ops[i].publicKey,r.round,w,r.ctx.input_hash));}
f=await finish(r);assert.equal(f.ctx.outcome,5);await close(r.round);record('zero median closes without publication', {signature:f.signature});
cfg={...cfg,caps_bps:pad([5000,5000,5000,5000]),categories:pad([0,1,1,1]),category_caps_bps:[10000,7000,0,0]};await send(admin,ix.configure(admin.publicKey,cfg,true));
r=await open();const frozenHash=[...r.ctx.input_hash];
const computed=computeSnapshot(r.ctx);assert(computed.weights&&validPolicyWeights(computed.weights,r.ctx.config,r.ctx.eligible));
// An in-flight round retains the complete old policy despite a governance update.
await send(admin,ix.configure(admin.publicKey,{...cfg,risk_bps:pad([9999,9999,9999,9999])},true));
assert.deepEqual(decodeContext(await data(ix.context(r.round))).input_hash,frozenHash);
await reject(ops[0],ix.submitV2(ops[0].publicKey,r.round,pad([0,5000,5000]),r.ctx.input_hash),6021);
for(const k of ops.slice(0,3))await send(k,ix.submitV2(k.publicKey,r.round,computed.weights,r.ctx.input_hash));
await reject(ops[0],ix.submitV2(ops[0].publicKey,r.round,computed.weights,r.ctx.input_hash),6013);
f=await finish(r);assert.equal(f.ctx.outcome,1);assert.deepEqual(decodeAllocation(await data(ix.allocationState())).weights,computed.weights);
await reject(admin,ix.closeV2(admin.publicKey,r.round),6024);
record('three consumers publish exact frozen-policy computation; latest proof retained',{signature:f.signature,weights:computed.weights});
await send(admin,ix.configure(admin.publicKey,cfg,true));
const older=await open(),newer=await open();
for(const round of [older,newer])for(const k of ops.slice(0,3))await send(k,ix.submitV2(k.publicKey,round.round,computed.weights,round.ctx.input_hash));
await finish(newer);f=await finish(older);assert.equal(f.ctx.outcome,3);await close(older.round);await close(r.round);record('superseded allocation closes; older published proof can now be reclaimed');
r=await open();for(const k of ops.slice(0,2))await send(k,ix.submitV2(k.publicKey,r.round,computed.weights,r.ctx.input_hash));f=await finish(r);assert.equal(f.ctx.outcome,2);await close(r.round);record('two of three consumers cannot publish');
await send(admin,ix.configure(admin.publicKey,{...cfg,max_stale_slots:pad([1,1,1,1])},true));
r=await open();assert(r.ctx.eligible.every(x=>x===0));assert.equal(computeSnapshot(r.ctx).weights,null);await reject(ops[0],ix.submitV2(ops[0].publicKey,r.round,computed.weights,r.ctx.input_hash),6021);record('stale input excluded on chain and consumers abstain');
await wait(r.end);await send(admin,ix.finalizeV2(admin.publicKey,r.round));await close(r.round);
await send(admin,ix.configure(admin.publicKey,{...cfg,max_round_slots:110},true));r=await open();for(const k of ops.slice(0,3))await send(k,ix.submitV2(k.publicKey,r.round,computed.weights,r.ctx.input_hash));await wait(r.ctx.anchor_slot+111n);f=await finish(r);assert.equal(f.ctx.outcome,6);await close(r.round);record('late finalizer cannot publish expired snapshot');
await reject(admin,ix.updateFeed(admin.publicKey,30,0,{...base,min_interval_slots:1000,max_interval_slots:1}),6006);
await reject(admin,ix.updateFeed(admin.publicKey,30,0,{...base,window_slots:61}),6019);record('contradictory intervals and mutable window rejected');
// Finalize a newer sample first, then retire an older funded round.
await send(admin,ix.initFeed(admin.publicKey,40,0,{...base,window_slots:40,max_interval_slots:40}));
let now=await slot();if((now/40n+1n)*40n-now<20n)await wait((now/40n+1n)*40n);now=await slot();const a=now/40n;
await send(ops[0],ix.sample('propose_sample',ops[0].publicKey,40,0,a,100n,now));await wait((a+1n)*40n);now=await slot();const b=now/40n;
await send(ops[0],ix.sample('propose_sample',ops[0].publicKey,40,0,b,200n,now));await wait((b+1n)*40n);await send(admin,ix.finalizeSample(admin.publicKey,40,0,b));await send(admin,ix.finalizeSample(admin.publicKey,40,0,a));assert.equal(decodeSample(await data(ix.samplePda(40,0,a))).status,1);
const closeSample=new TransactionInstruction({programId:ix.program,keys:[{pubkey:ix.feed(40,0),isWritable:false,isSigner:false},{pubkey:ix.samplePda(40,0,a),isWritable:true,isSigner:false},{pubkey:ops[0].publicKey,isWritable:true,isSigner:true}],data:Buffer.concat([discriminator('global','close_sample_consensus'),u64(a)])});await send(ops[0],closeSample);record('superseded sample closes and returns payer rent');
await writeFile(process.env.TEST_RESULTS??'/tmp/quorum-v2-test/results.json',JSON.stringify({network:'local validator',passed:results.length,results},(_,v)=>typeof v==='bigint'?String(v):v,2));
console.log(`All ${results.length} lifecycle checks passed.`);
