// Re-check stored RPC evidence without wallets or additional chain writes.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeSample, decodeRound, decodeAllocation } from './common.mjs';
import { createPresentation } from './presentation.mjs';

const out=join(import.meta.dirname,'evidence','latest');
const load=async f=>JSON.parse(await readFile(join(out,`${f}.json`),'utf8'));
const [result,snapshots,events,transactions]=await Promise.all(['outcome','snapshots','events','transactions'].map(load));
const normalize=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
const archived=new Map();
for(const e of events.filter(e=>e.account)) {
  const decode=e.event.includes('sample')?decodeSample:e.event.includes('consensus')||e.event.includes('test_allocation')?decodeRound:decodeAllocation;
  assert.deepEqual(normalize(decode(Buffer.from(e.account.raw_base64,'base64'))),e.account.decoded);
  archived.set(e.account.pda,e.account);
}
let refunds=0;
for(const tx of transactions) {
  assert.equal(tx.raw.meta.err,null);
  const closes=tx.decoded.filter(d=>['close_sample_consensus','close_allocation_consensus'].includes(d.name));
  if(!closes.length) continue;
  const recipient=closes[0].accounts[2];assert(closes.every(d=>d.accounts[2]===recipient));
  const rent=closes.reduce((sum,d)=>{const a=archived.get(d.accounts[1]);assert(a,'archive missing');return sum+a.lamports;},0);
  const keys=[...tx.raw.transaction.message.accountKeys,...(tx.raw.meta.loadedAddresses?.writable??[]),...(tx.raw.meta.loadedAddresses?.readonly??[])];
  const i=keys.indexOf(recipient);assert(i>=0);
  const net=tx.raw.meta.postBalances[i]-tx.raw.meta.preBalances[i];assert.equal(net,rent-(i===0?tx.fee_lamports:0));
  tx.rent_refund={recipient,closed_accounts:closes.map(d=>d.accounts[1]),rent_lamports:rent,net_returned_lamports:net};refunds+=closes.length;
}
result.verified_rent_refunds=refunds;
await writeFile(join(out,'outcome.json'),JSON.stringify(result,null,2)+'\n');
await writeFile(join(out,'transactions.json'),JSON.stringify(transactions,null,2)+'\n');
await createPresentation(out,result,snapshots.snapshots,events,transactions);
const files=(await readdir(out)).filter(f=>f!=='SHA256SUMS').sort();
await writeFile(join(out,'SHA256SUMS'),(await Promise.all(files.map(async f=>`${createHash('sha256').update(await readFile(join(out,f))).digest('hex')}  ${f}`))).join('\n')+'\n');
console.log(JSON.stringify({status:'verified',transactions:transactions.length,archived_accounts:archived.size,rent_refunds:refunds}));
