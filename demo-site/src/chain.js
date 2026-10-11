import {PublicKey} from '@solana/web3.js';
import BN from 'bn.js';
import {BorshAccountsCoder} from '@coral-xyz/anchor/dist/esm/coder/borsh/accounts.js';
import idl from './idl.json';
const coder=new BorshAccountsCoder(idl);
export const stringify=v=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?String(v):v,2);
export const plain=v=>BN.isBN(v)?BigInt(v.toString()):v instanceof PublicKey?v.toBase58():Array.isArray(v)?v.map(plain):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
export const decode=(name,b)=>plain(coder.decode(name,b));
const verify=(name,b,min)=>{if(b.length<min||!b.subarray(0,8).equals(Buffer.from(idl.accounts.find(a=>a.name===name).discriminator)))throw Error(`Invalid ${name} data`);};
export function feed(b){verify('DataFeed',b,8248);const head=b.readUInt16LE(46),tick=b.readBigUInt64LE(8),count=Number(tick<256n?tick:256n);if(head>255)throw Error('Invalid ring head');const history=Array.from({length:count},(_,i)=>{const o=56+((head-count+i+256)%256)*32;return {value:b.readBigUInt64LE(o),slot:b.readBigUInt64LE(o+8),tick:b.readBigUInt64LE(o+16),timestamp:b.readBigInt64LE(o+24)};});return {tick,last_finalized_slot:b.readBigUInt64LE(16),value:b.readBigUInt64LE(24),window_slots:b.readUInt32LE(32),head,pool_id:b[48],data_id:b[49],history};}
export function consensus(b){verify('AllocationConsensus',b,6464);const count=b[28];if(count>100||b[24]>2)throw Error('Invalid allocation consensus');return {round:b.readBigUInt64LE(8),closes:b.readBigUInt64LE(16),status:b[24],quorum:b[25],count,output:Array.from({length:16},(_,i)=>b.readUInt16LE(30+i*2)),submissions:Array.from({length:count},(_,i)=>({operator:new PublicKey(b.subarray(62+i*64,94+i*64)).toBase58(),weights:Array.from({length:16},(_,j)=>b.readUInt16LE(94+i*64+j*2))}))};}
export function sample(b){verify('DataFeedConsensus',b,4072);const count=b[68];if(count>100)throw Error('Invalid sample consensus');return {window:b.readBigUInt64LE(40),closes:b.readBigUInt64LE(48),output:b.readBigUInt64LE(56),status:b[64],quorum:b[65],count,submissions:Array.from({length:count},(_,i)=>({operator:new PublicKey(b.subarray(72+i*40,104+i*40)).toBase58(),value:b.readBigUInt64LE(104+i*40)}))};}
export function pda(program,seed,round){const seeds=[Buffer.from(seed)];if(round!==undefined){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(round));seeds.push(b);}return PublicKey.findProgramAddressSync(seeds,new PublicKey(program))[0].toBase58();}
export function samplePda(program,feed,window){const b=Buffer.alloc(8);b.writeBigUInt64LE(window);return PublicKey.findProgramAddressSync([Buffer.from('tick_consensus'),new PublicKey(feed).toBuffer(),b],new PublicKey(program))[0].toBase58();}
export async function verifySnapshot(bytes,snapshot){const n=snapshot.config.consumers.length,len=1141+32*n;if(bytes.length<len)throw Error('Truncated snapshot');const content=Buffer.from(bytes.subarray(0,len));content.fill(0,32,64);content[464]=0;const hash=Buffer.from(await crypto.subtle.digest('SHA-256',content));return hash.equals(Buffer.from(snapshot.input_hash));}
export function createRpc(url){let id=0;return async(method,params=[])=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`RPC HTTP ${response.status}`);const body=await response.json();if(body.error)throw Error(body.error.message);return body.result;};}
export async function readLive(config,rpc){
 const r=await rpc('getMultipleAccounts',[[config.allocation_state,config.policy,...config.feeds.map(f=>f.pda)],{encoding:'base64',commitment:'confirmed'}]);
 const unwrap=a=>{if(!a)return null;if(a.owner!==config.program_id)throw Error('Unexpected account owner');return Buffer.from(a.data[0],'base64');};
 const bytes=r.value.map(unwrap);if(bytes.some(b=>!b))throw Error('Waiting for configured on-chain accounts');
 const allocation=decode('AllocationState',bytes[0]),policy=decode('AllocationPolicy',bytes[1]),feeds=bytes.slice(2).map(feed);
 const rounds=[...new Set([allocation.round,policy.active_round].filter(r=>r>0n).map(String))];
 const keys=rounds.flatMap(round=>[pda(config.program_id,'round_context',round),pda(config.program_id,'consensus',round)]);
 const accounts=keys.length?await rpc('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed'}]):{value:[]};
 const proofs={};
 for(let i=0;i<rounds.length;i++){const ctx=unwrap(accounts.value[2*i]),con=unwrap(accounts.value[2*i+1]);if(ctx&&con){const snapshot=decode('RoundContext',ctx);if(!await verifySnapshot(ctx,snapshot))throw Error('Input snapshot commitment failed verification');proofs[rounds[i]]={snapshot,consensus:consensus(con),address:keys[2*i],consensus_address:keys[2*i+1],raw_base64:ctx.toString('base64'),hash_verified:true};}}
 const windows=feeds.map(f=>BigInt(r.context.slot)/BigInt(f.window_slots));
 const samples=await rpc('getMultipleAccounts',[windows.map((w,i)=>samplePda(config.program_id,config.feeds[i].pda,w)),{encoding:'base64',commitment:'confirmed'}]);
 return {observed_at:new Date().toISOString(),slot:r.context.slot,allocation,policy,feeds,proofs,samples:samples.value.map(a=>a?sample(unwrap(a)):null)};
}
