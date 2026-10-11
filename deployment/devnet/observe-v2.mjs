// Capture decoded accounts and transaction evidence for the policy-bound fleet.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {BorshInstructionCoder} from '@coral-xyz/anchor';
import {client,STATE,ROOT,load,save,json,pause,account,decodeFeed,decodeAllocation,decodeRound,decodeSample} from './common.mjs';
import {decodePolicy,decodeContext,plain} from './policy-codec.mjs';
import {computeSnapshot,validPolicyWeights} from './policy-math.mjs';
const c=await client(`http://127.0.0.1:${process.env.FLEET_RPC_PORT??18789}`),out=join(import.meta.dirname,'evidence','v2');await mkdir(out,{recursive:true});
const duration=Number(process.env.OBSERVE_SECONDS??240);assert(duration>=120&&duration<=3600);
const started_at=new Date().toISOString(),snapshots=[],deadline=Date.now()+duration*1000;
while(Date.now()<deadline){
 try{
  const addresses=[c.ix.allocationState(),c.ix.policy(),...c.config.feeds.map(f=>c.ix.feed(f.pool_id,0))];
  const r=await c.connection.getMultipleAccountsInfoAndContext(addresses);
  const accounts=r.value.map((a,i)=>{assert(a&&a.owner.toBase58()===c.config.program_id);const decode=i===0?decodeAllocation:i===1?decodePolicy:decodeFeed;return {pda:addresses[i].toBase58(),owner:a.owner.toBase58(),lamports:a.lamports,raw_base64:a.data.toString('base64'),decoded:decode(a.data)};});
  const round=accounts[0].decoded.round,context=await account(c,c.ix.context(round),decodeContext),consensus=await account(c,c.ix.allocationPda(round),decodeRound);
  if(context&&consensus){assert(validPolicyWeights(accounts[0].decoded.weights,context.decoded.config,context.decoded.eligible));assert.equal(consensus.decoded.count,3);assert.deepEqual(computeSnapshot(context.decoded).weights,accounts[0].decoded.weights);const b=Buffer.from(context.raw_base64,'base64').subarray(0,1141+32*context.decoded.config.consumers.length);b.fill(0,32,64);b[464]=0;assert.equal(createHash('sha256').update(b).digest('hex'),Buffer.from(context.decoded.input_hash).toString('hex'));}
  snapshots.push({at:new Date().toISOString(),context_slot:r.context.slot,accounts,context,consensus});
  await save(join(out,'snapshots.json'),snapshots);
  console.log(json({round,slot:r.context.slot,weights:accounts[0].decoded.weights.slice(0,3),proof_verified:!!context,feed_ticks:accounts.slice(2).map(a=>a.decoded.tick)}));
 }catch(e){console.log('Observation retry:',e.message);}
 await pause(Math.min(15000,Math.max(0,deadline-Date.now())));
}
const events=[],roles=['coordinator',...c.config.producers.map(p=>p.role),...c.config.consumers.map(p=>p.role)];
for(const [base,names] of [[STATE,['setup']],[join(STATE,'runtime'),roles]])for(const role of names){try{for(const line of (await readFile(join(base,role,'events.jsonl'),'utf8')).trim().split('\n'))if(line){const e=JSON.parse(line);if(role==='setup'||e.at>=(process.env.EVIDENCE_START??started_at))events.push(e);}}catch(e){if(e.code!=='ENOENT')throw e;}}
const deployment=await load(join(STATE,'deployment.json'));
const verification=events.filter(e=>e.event==='deployment_verified').at(-1);
const evidenceStart=process.env.EVIDENCE_START??started_at;
const relevant=events.filter(e=>e.role==='setup'?e.at>=verification.at:e.at>=evidenceStart);relevant.sort((a,b)=>a.at.localeCompare(b.at));
const signatures=new Map(relevant.filter(e=>e.event==='transaction_confirmed').map(e=>[e.signature,{label:e.label,role:e.role}]));signatures.set(deployment.signature,{label:'upgrade policy-bound program',role:'deployer'});
const coder=new BorshInstructionCoder(JSON.parse(await readFile(join(ROOT,'sdk/idl/quorum_allocation.json'),'utf8'))),transactions=[];
for(const [signature,meta]of signatures){let tx;for(let i=0;i<4;i++){const r=await c.connection._rpcRequest('getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);tx=r.result;if(tx)break;await pause(1000*(i+1));}assert(tx,`missing confirmed transaction ${signature}`);assert.equal(tx.meta.err,null);const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];const decoded=tx.transaction.message.instructions.map(i=>({program:keys[i.programIdIndex],accounts:i.accounts.map(j=>keys[j]),...(keys[i.programIdIndex]===c.config.program_id?plain(coder.decode(i.data,'base58')):{name:'external_program',data_base58:i.data})}));transactions.push({signature,...meta,slot:tx.slot,decoded,raw:tx});}
const pubs=[...new Set(snapshots.filter(s=>s.context).map(s=>String(s.accounts[0].decoded.round)))];assert(pubs.length>=2,'observe at least two distinct policy-bound publications');
const containers=execFileSync('sudo',['-n','docker','compose','-f',join(import.meta.dirname,'compose.yaml'),'ps','--format','json'],{encoding:'utf8'}).trim().split('\n').map(JSON.parse);assert.equal(containers.length,15);assert(containers.every(c=>c.State==='running'&&c.Health==='healthy'));
const archived=relevant.filter(e=>e.event==='sample_consensus_archived');for(const e of archived){const sample=decodeSample(Buffer.from(e.account.raw_base64,'base64'));assert.equal(new Set(sample.submissions.map(s=>s.operator)).size,sample.count);if(sample.status===2){assert.equal(sample.count,3);const values=sample.submissions.map(s=>s.value).sort((a,b)=>a<b?-1:a>b?1:0);assert.equal(sample.output,values[1]);}}
const outcome={schema_version:2,status:'verified',started_at,finished_at:new Date().toISOString(),network:'devnet',observation_seconds:duration,observed_publications:pubs.length,snapshots:snapshots.length,confirmed_transactions:transactions.length,sample_archives:archived.length,latest_allocation:snapshots.at(-1).accounts[0].decoded,allocation_pda:c.ix.allocationState().toBase58(),policy_pda:c.ix.policy().toBase58(),program_id:c.config.program_id,upgrade_signature:deployment.signature,containers,containers_left_running:true};
await save(join(out,'events.json'),relevant);await save(join(out,'transactions.json'),transactions);await save(join(out,'outcome.json'),outcome);
await save(join(ROOT,'demo-site/dist/evidence.json'),{outcome,transactions:transactions.map(({raw,...t})=>t)});
for(const f of ['snapshots.json','events.json','transactions.json','outcome.json','evidence.json']){const p=f==='evidence.json'?join(ROOT,'demo-site/dist',f):join(out,f);await import('node:fs/promises').then(fs=>fs.chmod(p,0o644));}
const names=(await readdir(out)).filter(f=>f.endsWith('.json'));await writeFile(join(out,'SHA256SUMS'),(await Promise.all(names.map(async f=>`${createHash('sha256').update(await readFile(join(out,f))).digest('hex')}  ${f}`))).join('\n')+'\n');console.log(json(outcome));
