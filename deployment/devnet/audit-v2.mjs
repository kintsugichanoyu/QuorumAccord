// Verify stored public evidence without wallets or chain writes.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {decodeSample,decodeRound,save,ROOT} from './common.mjs';
import {decodeContext} from './policy-codec.mjs';
const out=join(import.meta.dirname,'evidence/v2');
const read=async f=>JSON.parse(await readFile(join(out,f+'.json'),'utf8'));
const [outcome,events,transactions]=await Promise.all(['outcome','events','transactions'].map(read));
const archives=new Map();
for(const e of events){
 if(e.event==='sample_consensus_archived')archives.set(e.account.pda,{...e.account,decoded:decodeSample(Buffer.from(e.account.raw_base64,'base64'))});
 if(e.event==='allocation_consensus_archived'){
  archives.set(e.account.pda,{...e.account,decoded:decodeRound(Buffer.from(e.account.raw_base64,'base64'))});
  if(e.snapshot)archives.set(e.snapshot.pda,{...e.snapshot,decoded:decodeContext(Buffer.from(e.snapshot.raw_base64,'base64'))});
 }
}
let refunds=0,fundingTransfers=0;
for(const tx of transactions){
 assert.equal(tx.raw.meta.err,null);
 tx.fee_lamports=tx.raw.meta.fee;
 for(const d of tx.decoded){
  if(d.program==='11111111111111111111111111111111'&&d.data_base58){
   const b=Buffer.from(bs58.decode(d.data_base58));
   if(b.length===12&&b.readUInt32LE(0)===2){d.name='system_transfer';d.data={lamports:b.readBigUInt64LE(4).toString(),from:d.accounts[0],to:d.accounts[1]};fundingTransfers++;}
  }
 }
 const closes=tx.decoded.filter(d=>['close_sample_consensus','close_allocation_round_v2'].includes(d.name));
 if(!closes.length)continue;
 const keys=[...tx.raw.transaction.message.accountKeys,...(tx.raw.meta.loadedAddresses?.writable??[]),...(tx.raw.meta.loadedAddresses?.readonly??[])];
 const recipientFor=d=>d.accounts[d.name==='close_allocation_round_v2'?4:2];
 const recipient=recipientFor(closes[0]);assert(closes.every(d=>recipientFor(d)===recipient));
 const closed=closes.flatMap(d=>d.name==='close_allocation_round_v2'?[d.accounts[2],d.accounts[3]]:[d.accounts[1]]);
 const rent=closed.reduce((sum,pda)=>{const a=archives.get(pda);assert(a,`missing rent archive ${pda}`);assert.notEqual(a.decoded.status??a.decoded.outcome,0);return sum+a.lamports;},0);
 const i=keys.indexOf(recipient);assert(i>=0);
 const net=tx.raw.meta.postBalances[i]-tx.raw.meta.preBalances[i];
 assert.equal(net,rent-(i===0?tx.raw.meta.fee:0));
 for(const pda of closed){const j=keys.indexOf(pda);assert.equal(tx.raw.meta.postBalances[j],0);}
 tx.rent_refund={recipient,closed_accounts:closed,rent_lamports:rent,net_returned_lamports:net};refunds+=closed.length;
}
outcome.verified_rent_refunds=refunds;outcome.decoded_funding_transfers=fundingTransfers;
await save(join(out,'transactions.json'),transactions);await save(join(out,'outcome.json'),outcome);
await save(join(ROOT,'demo-site/dist/evidence.json'),{outcome,transactions:transactions.map(({raw,...t})=>t)});
const names=(await readdir(out)).filter(f=>f.endsWith('.json')).sort();
await writeFile(join(out,'SHA256SUMS'),(await Promise.all(names.map(async f=>`${createHash('sha256').update(await readFile(join(out,f))).digest('hex')}  ${f}`))).join('\n')+'\n');
console.log(JSON.stringify({transactions:transactions.length,verified_rent_refunds:refunds,decoded_funding_transfers:fundingTransfers}));
