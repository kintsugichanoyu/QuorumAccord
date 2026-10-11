import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {Instructions,decodeAllocation,decodeSample,decodeFeed,discriminator,u64} from '/home/user/reflect/testing/devnet/dist/src/codec.js';
const {Connection,Keypair,PublicKey,Transaction,TransactionInstruction,sendAndConfirmTransaction}=createRequire('/home/user/reflect/testing/devnet/package.json')('@solana/web3.js');
const rpc=new Connection('http://127.0.0.1:18899','confirmed');
const admin=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('/tmp/quorum-logic-review/admin.json','utf8'))));
const ops=Array.from({length:3},()=>Keypair.generate());
const ix=new Instructions(new PublicKey('DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const slot=async()=>BigInt(await rpc.getSlot());
const wait=async target=>{while(await slot()<target)await pause(100);};
const account=async key=>(await rpc.getAccountInfo(key)).data;
const results=[];results.push=(...items)=>{console.log(JSON.stringify(items));return Array.prototype.push.apply(results,items);};
const send=async(key,...instructions)=>{const bh=await rpc.getLatestBlockhash('confirmed');const tx=new Transaction({feePayer:key.publicKey,...bh}).add(...instructions);tx.sign(key);const signature=await rpc.sendRawTransaction(tx.serialize(),{preflightCommitment:'confirmed',maxRetries:3});const confirmation=await rpc.confirmTransaction({...bh,signature},'confirmed');assert.equal(confirmation.value.err,null);return signature;};
async function reject(key,instruction,code) {
 const tx=new Transaction({feePayer:key.publicKey,...await rpc.getLatestBlockhash()}).add(instruction);tx.sign(key);
 const sim=await rpc._rpcRequest('simulateTransaction',[tx.serialize().toString('base64'),{encoding:'base64',commitment:'confirmed',replaceRecentBlockhash:true}]);
 const value=sim.result.value;
 assert.deepEqual(value.err,{InstructionError:[0,{Custom:code}]});
 return value.err;
}
function closeRound(round){return new TransactionInstruction({programId:ix.program,keys:[{pubkey:ix.registry(),isWritable:false,isSigner:false},{pubkey:ix.allocationPda(round),isWritable:true,isSigner:false},{pubkey:admin.publicKey,isWritable:true,isSigner:true}],data:Buffer.concat([discriminator('global','close_allocation_consensus'),u64(round)])});}
function closeSample(pool,window){return new TransactionInstruction({programId:ix.program,keys:[{pubkey:ix.feed(pool,0),isWritable:false,isSigner:false},{pubkey:ix.samplePda(pool,0,window),isWritable:true,isSigner:false},{pubkey:ops[0].publicKey,isWritable:true,isSigner:true}],data:Buffer.concat([discriminator('global','close_sample_consensus'),u64(window)])});}
const weights=(...values)=>[...values,...Array(16-values.length).fill(0)];
for(const key of [admin,...ops]){const sig=await rpc.requestAirdrop(key.publicKey,5e9);await rpc.confirmTransaction(sig,'confirmed');}
if(!await rpc.getAccountInfo(ix.registry()))await send(admin,ix.initRegistry(admin.publicKey),ix.initAllocation(admin.publicKey));
for(const op of ops) await send(admin,ix.addOperator(admin.publicKey,op.publicKey));
let end=await slot()+60n;
await send(admin,ix.openAllocation(admin.publicKey,110n,end,3,1));
for(let i=0;i<3;i++){const w=weights(5000);w[i+1]=5000;await send(ops[i],ix.submitWeights(ops[i].publicKey,110n,w));}
await wait(end);const capSig=await send(admin,ix.finalizeAllocation(admin.publicKey,110n));
let state=decodeAllocation(await account(ix.allocationState()));assert.equal(state.weights[0],10000);
results.push({case:'median_breaks_50_percent_caps',output:state.weights,signature:capSig});
end=await slot()+60n;await send(admin,ix.openAllocation(admin.publicKey,111n,end,3,1));
for(let i=0;i<3;i++){const w=weights();w[i]=10000;await send(ops[i],ix.submitWeights(ops[i].publicKey,111n,w));}
await wait(end);
const zeroError=await reject(admin,ix.finalizeAllocation(admin.publicKey,111n),6016);
assert.equal((await account(ix.allocationPda(111n)))[24],0);
await reject(admin,closeRound(111n),6008);
results.push({case:'zero_median_round_remains_open_and_cannot_close',error:zeroError,status:0});
end=await slot()+60n;
for(const round of [112n,113n]){await send(admin,ix.openAllocation(admin.publicKey,round,end,1,0));await send(ops[0],ix.submitWeights(ops[0].publicKey,round,weights(5000,5000)));}
await wait(end);await send(admin,ix.finalizeAllocation(admin.publicKey,113n));
await reject(admin,ix.finalizeAllocation(admin.publicKey,112n),6018);await reject(admin,closeRound(112n),6008);
results.push({case:'stale_allocation_cannot_close',status:(await account(ix.allocationPda(112n)))[24]});
const cfg={measurand:0,window_slots:40,threshold_bps:0,min_interval_slots:0,max_interval_slots:40,min_number:1,rule:1,trim_pct:0};
await send(admin,ix.initFeed(admin.publicKey,20,0,cfg));
let now=await slot();if((now/40n+1n)*40n-now<20n)await wait((now/40n+1n)*40n);
now=await slot();const older=now/40n;
await send(ops[0],ix.sample('propose_sample',ops[0].publicKey,20,0,older,100n,now));
await wait((older+1n)*40n);now=await slot();const newer=now/40n;
await send(ops[0],ix.sample('propose_sample',ops[0].publicKey,20,0,newer,1110n,now));
await wait((newer+1n)*40n);await send(admin,ix.finalizeSample(admin.publicKey,20,0,newer));
await reject(admin,ix.finalizeSample(admin.publicKey,20,0,older),6018);await reject(ops[0],closeSample(20,older),6008);
results.push({case:'stale_sample_cannot_close',status:decodeSample(await account(ix.samplePda(20,0,older))).status});
// Configuring min_interval above max_interval is accepted, making refresh promises inconsistent.
await send(admin,ix.updateFeed(admin.publicKey,20,0,{...cfg,min_interval_slots:1000,max_interval_slots:1}));
results.push({case:'contradictory_intervals_accepted',min:1000,max:1});
// A live width update changes the index namespace and collides with a retained account.
await send(admin,ix.initFeed(admin.publicKey,21,0,{...cfg,window_slots:80,max_interval_slots:80}));
now=await slot();if((now/80n+1n)*80n-now<20n)await wait((now/80n+1n)*80n);
now=await slot();const original=now/80n;
await send(ops[0],ix.sample('propose_sample',ops[0].publicKey,21,0,original,100n,now));
await wait((original+1n)*80n);await send(admin,ix.finalizeSample(admin.publicKey,21,0,original));
now=await slot();const newWidth=Number(now/original);
assert(newWidth>80);
await send(admin,ix.updateFeed(admin.publicKey,21,0,{...cfg,window_slots:newWidth,max_interval_slots:newWidth}));
now=await slot();const reindexed=now/BigInt(newWidth);assert.equal(reindexed,original);
const tx=new Transaction({feePayer:ops[1].publicKey,...await rpc.getLatestBlockhash()}).add(ix.sample('propose_sample',ops[1].publicKey,21,0,reindexed,101n,now));tx.sign(ops[1]);
const collision=(await rpc._rpcRequest('simulateTransaction',[tx.serialize().toString('base64'),{encoding:'base64',commitment:'confirmed',replaceRecentBlockhash:true}])).result.value;assert(collision.err);assert(collision.logs.some(l=>l.includes('already in use')));
await reject(ops[1],ix.sample('corroborate_sample',ops[1].publicKey,21,0,reindexed,101n,now),6009);
results.push({case:'window_width_change_collides_with_old_pda',old_width:80,new_width:newWidth,index:original.toString(),error:collision.err});
await writeFile('/tmp/quorum-logic-review/onchain-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
