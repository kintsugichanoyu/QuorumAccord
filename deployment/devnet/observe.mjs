import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BorshInstructionCoder } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { client, STATE, ROOT, load, save, json, pause, decodeFeed, decodeAllocation, decodeSample, decodeRound, decodeRegistry } from './common.mjs';
import { createPresentation } from './presentation.mjs';

const duration=Number(process.env.OBSERVE_SECONDS ?? 360);
assert(Number.isFinite(duration) && duration>=120 && duration<=3600,'OBSERVE_SECONDS must be 120..3600');
const config=await load(join(STATE,'config.json'));
const c=await client(`http://127.0.0.1:${process.env.FLEET_RPC_PORT ?? 18789}`);
const out=join(import.meta.dirname,'evidence','latest');await mkdir(out,{recursive:true});
const start=new Date().toISOString(), snapshots=[];
const addresses=[c.ix.allocationState(),...config.feeds.map(f=>c.ix.feed(f.pool_id,0)),c.ix.registry()];
const deadline=Date.now()+duration*1000;
while(Date.now()<deadline) {
  const response=await c.connection.getMultipleAccountsInfoAndContext(addresses);
  const accounts=response.value.map((a,i)=>{
    assert(a && a.owner.toBase58()===config.program_id,'PDA owner mismatch');
    const decode=i===0?decodeAllocation:i===4?decodeRegistry:decodeFeed;
    const decoded=decode(a.data);
    if(i>0 && i<4) {assert.equal(decoded.pool_id,config.feeds[i-1].pool_id);assert.equal(decoded.data_id,0);}
    return {pda:addresses[i].toBase58(),owner:a.owner.toBase58(),lamports:a.lamports,raw_base64:a.data.toString('base64'),decoded};
  });
  const snapshot={at:new Date().toISOString(),context_slot:String(response.context.slot),accounts};snapshots.push(snapshot);
  console.log(json({at:snapshot.at,context_slot:snapshot.context_slot,allocation:accounts[0].decoded,apy_bps:accounts.slice(1,4).map(a=>a.decoded.price)}));
  await save(join(out,'snapshots.json'),{started_at:start,snapshots});
  await pause(Math.min(15000,Math.max(0,deadline-Date.now())));
}
const events=[];
for(const [base,roles] of [[STATE,['setup']],[join(STATE,'runtime'),['consumer','oracle-1','oracle-2','oracle-3']]]) for(const role of roles) {
  try {for(const line of (await readFile(join(base,role,'events.jsonl'),'utf8')).trim().split('\n')) if(line) events.push(JSON.parse(line));}
  catch(e) {if(e.code!=='ENOENT') throw e;}
}
events.sort((a,b)=>a.at.localeCompare(b.at));
// Re-decode archived bytes instead of trusting the producer's decoded JSON.
for(const e of events.filter(e=>e.account)) {
  assert.equal(e.account.owner,config.program_id);
  const decode=e.event.includes('sample')?decodeSample:e.event.includes('consensus')||e.event.includes('test_allocation')?decodeRound:decodeAllocation;
  e.account.decoded=JSON.parse(json(decode(Buffer.from(e.account.raw_base64,'base64'))));
}
const deployment=await load(join(STATE,'deployment.json'),null);
const signatures=new Map(events.filter(e=>e.event==='transaction_confirmed').map(e=>[e.signature,{label:e.label,role:e.role}]));
if(deployment?.signature) signatures.set(deployment.signature,{label:'deploy / upgrade main program',role:'deployer'});
const idl=JSON.parse(await readFile(join(ROOT,'sdk/idl/quorum_allocation.json'),'utf8'));
const coder=new BorshInstructionCoder(idl);
function normalize(v) {
  if(v?.constructor?.name==='BN') return v.toString(10);
  if(v?.toBase58) return v.toBase58();
  if(Array.isArray(v)) return v.map(normalize);
  if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]));
  return v;
}
const transactions=[];
for(const [signature,meta] of signatures) {
  let raw;
  for(let attempt=0;attempt<6;attempt++) {
    raw=await c.connection._rpcRequest('getTransaction',[signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:0}]);
    if(raw.result) break;await pause(1500*(attempt+1));
  }
  assert(raw?.result,`transaction not retrievable: ${signature}`);const tx=raw.result;
  assert.equal(tx.meta.err,null,`failed confirmed transaction ${signature}`);
  const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  const decoded=tx.transaction.message.instructions.map(ix=>{
    const program=keys[ix.programIdIndex],data=Buffer.from(bs58.decode(ix.data));
    let instruction;
    if(program===config.program_id) { const d=coder.decode(data);assert(d,'unknown quorum instruction');instruction=normalize(d); }
    else if(program==='11111111111111111111111111111111' && data.readUInt32LE(0)===2) instruction={name:'system_transfer',data:{lamports:data.readBigUInt64LE(4).toString()}};
    else if(program==='BPFLoaderUpgradeab1e11111111111111111111111') instruction={name:'upgradeable_loader',data:{variant:data.readUInt32LE(0)}};
    else instruction={name:'other_program',data_base58:ix.data};
    return {program,accounts:ix.accounts.map(i=>keys[i]),...instruction};
  });
  transactions.push({signature,...meta,slot:String(tx.slot),block_time:tx.blockTime,fee_lamports:tx.meta.fee,compute_units:tx.meta.computeUnitsConsumed,decoded,raw:tx});
}
const published=events.filter(e=>e.event==='allocation_published' && e.at>=start);
const latest=snapshots.at(-1).accounts[0].decoded;
const finalized=events.filter(e=>e.event==='sample_consensus_archived' && e.account.decoded.status===2);
const archivedAccounts=new Map(events.filter(e=>e.account).map(e=>[e.account.pda,e.account]));
let refunds=0;
for(const tx of transactions) {
  const closes=tx.decoded.filter(d=>['close_sample_consensus','close_allocation_consensus'].includes(d.name));
  if(!closes.length) continue;
  const recipient=closes[0].accounts[2];assert(closes.every(d=>d.accounts[2]===recipient));
  const rent=closes.reduce((sum,d)=>{const archived=archivedAccounts.get(d.accounts[1]);assert(archived,'rent reclamation must have an archived account');return sum+archived.lamports;},0);
  const keys=[...tx.raw.transaction.message.accountKeys,...(tx.raw.meta.loadedAddresses?.writable??[]),...(tx.raw.meta.loadedAddresses?.readonly??[])];
  const index=keys.indexOf(recipient);assert(index>=0);
  const returned=tx.raw.meta.postBalances[index]-tx.raw.meta.preBalances[index];
  assert.equal(returned,rent-(index===0?tx.fee_lamports:0),'rent must return to the constrained recipient');
  tx.rent_refund={recipient,closed_accounts:closes.map(d=>d.accounts[1]),rent_lamports:rent,net_returned_lamports:returned};refunds+=closes.length;
}
for(const e of finalized) {
  assert.equal(e.account.decoded.count,3); assert.equal(e.account.decoded.quorum,3);
  assert.deepEqual([...e.account.decoded.submissions.map(s=>s.operator)].sort(),[...config.operators].sort(),'sample quorum must be the three new oracle wallets');
  const values=e.account.decoded.submissions.map(s=>BigInt(s.value)).sort((a,b)=>a<b?-1:a>b?1:0);
  assert.equal(e.account.decoded.output,values[1].toString(),'published sample must be the median');
}
assert(published.length>=2,'need at least two allocations published during observation; increase OBSERVE_SECONDS');
assert(latest.weights.reduce((a,b)=>a+b,0)===10000 && latest.weights.slice(3).every(w=>w===0),'invalid final allocation');
assert(latest.weights.slice(0,3).every(w=>w<=5000),'demo cap exceeded');
let containers;
const composeArgs=['compose','-f',join(import.meta.dirname,'compose.yaml'),'ps','--format','json'];
try {containers=execFileSync('docker',composeArgs,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
catch {containers=execFileSync('sudo',['-n','docker',...composeArgs],{encoding:'utf8'});}
containers=containers.trim().startsWith('[')?JSON.parse(containers):containers.trim().split('\n').map(l=>JSON.parse(l));
assert.equal(containers.length,4);assert(containers.every(c=>c.State==='running' && c.Health==='healthy'),'fleet must remain running and healthy');
const result={schema_version:1,status:'verified',network:'devnet',started_at:start,finished_at:new Date().toISOString(),observation_seconds:duration,
  config,allocation_pda:c.ix.allocationState().toBase58(),latest_allocation:latest,
  snapshots:snapshots.length,observed_publications:published.length,verified_sample_windows:finalized.length,verified_rent_refunds:refunds,
  confirmed_transactions:transactions.length,fees_lamports:transactions.reduce((s,t)=>s+t.fee_lamports,0),containers,
  source_network:'mainnet (read-only)',sample_quorum:3,allocation_quorum:1,containers_left_running:true,
  boundaries:['Static neutral risk discount (0 bps) and 50% per-venue caps are an explicit demo policy.','Base supply interest APY excludes token incentive emissions.','The single consumer uses the devnet registry admin to open rounds; producer containers only receive their own key.','Samples attest agreement by three operators using the same public mainnet RPC; this is not source decentralization.','Latest feed reads have an RPC context lower bound; historical input commitments are not implemented.']};
await save(join(out,'outcome.json'),result);await save(join(out,'events.json'),events);await save(join(out,'transactions.json'),transactions);
await createPresentation(out,result,snapshots,events,transactions);
const files=(await readdir(out)).filter(f=>f!=='SHA256SUMS').sort();
await writeFile(join(out,'SHA256SUMS'),(await Promise.all(files.map(async f=>`${createHash('sha256').update(await readFile(join(out,f))).digest('hex')}  ${f}`))).join('\n')+'\n');
console.log(json(result));
