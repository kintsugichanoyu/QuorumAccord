import assert from 'node:assert/strict';
import anchor from '@coral-xyz/anchor';
import {PublicKey, SystemProgram, TransactionInstruction} from '@solana/web3.js';
import idl from '../../sdk/idl/quorum_allocation.json' with {type:'json'};
import {Instructions, u64} from '../../testing/devnet/dist/src/codec.js';
const {BorshAccountsCoder,BorshInstructionCoder,BN}=anchor;
const accounts=new BorshAccountsCoder(idl), instructions=new BorshInstructionCoder(idl);
export function plain(v) {
 if(BN.isBN(v))return BigInt(v.toString());
 if(v instanceof PublicKey)return v.toBase58();
 if(Array.isArray(v))return v.map(plain);
 if(v && typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)]));
 return v;
}
export const decodePolicy=data=>plain(accounts.decode('AllocationPolicy',data));
export const decodeContext=data=>plain(accounts.decode('RoundContext',data));
export class PolicyInstructions extends Instructions {
 policy(){return this.pda(Buffer.from('allocation_policy'));}
 context(round){return this.pda(Buffer.from('round_context'),u64(round));}
 instruction(name,keys,args={},remaining=[]) {
  const schema=idl.instructions.find(i=>i.name===name);assert(schema,`missing IDL instruction ${name}`);
  const metadata=schema.accounts.map(a=>{assert(keys[a.name],`missing ${a.name}`);return {pubkey:keys[a.name],isWritable:!!a.writable,isSigner:!!a.signer};});
  return new TransactionInstruction({programId:this.program,keys:[...metadata,...remaining],data:instructions.encode(name,args)});
 }
 configure(admin,config,exists=false) {
  const value={...config,feeds:config.feeds.map(x=>new PublicKey(x)),consumers:config.consumers.map(x=>new PublicKey(x))};
  return this.instruction(exists?'update_allocation_policy':'init_allocation_policy',{registry:this.registry(),policy:this.policy(),admin,system_program:SystemProgram.programId},{config:value});
 }
 openV2(admin,round,closes,feeds,rule=1,trim=0) {
  return this.instruction('open_allocation_round_v2',{registry:this.registry(),policy:this.policy(),consensus:this.allocationPda(round),round_context:this.context(round),admin,system_program:SystemProgram.programId},{round:new BN(String(round)),closes_at_slot:new BN(String(closes)),rule,trim_pct:trim},feeds.map(pubkey=>({pubkey:new PublicKey(pubkey),isWritable:false,isSigner:false})));
 }
 submitV2(operator,round,weights,inputHash) {
  return this.instruction('submit_weights_v2',{registry:this.registry(),consensus:this.allocationPda(round),round_context:this.context(round),operator},{round:new BN(String(round)),weights,input_hash:[...inputHash]});
 }
 finalizeV2(cranker,round) {return this.instruction('finalize_allocation_v2',{policy:this.policy(),consensus:this.allocationPda(round),round_context:this.context(round),allocation_state:this.allocationState(),cranker},{round:new BN(String(round))});}
 closeV2(admin,round) {return this.instruction('close_allocation_round_v2',{registry:this.registry(),policy:this.policy(),consensus:this.allocationPda(round),round_context:this.context(round),admin},{round:new BN(String(round))});}
}
