// Compare the generated SDK ABI to the Anchor codec used by the validator-tested fleet.
import assert from 'node:assert/strict';
import {address,createNoopSigner,isSignerRole,isWritableRole} from '../../../sdk/node_modules/@solana/kit/dist/index.node.mjs';
import {Keypair,PublicKey} from '@solana/web3.js';
import * as sdk from '../../../sdk/dist/ts/index.js';
import {PolicyInstructions} from '../policy-codec.mjs';
const ix=new PolicyInstructions(new PublicKey(sdk.QUORUM_ALLOCATION_PROGRAM_ADDRESS));
const admin=Keypair.generate().publicKey,operator=Keypair.generate().publicKey;
const a=p=>address(p.toBase58()),signer=p=>createNoopSigner(a(p)),pad=(xs,value=0)=>[...xs,...Array(16-xs.length).fill(value)];
const feeds=[ix.feed(90,0),ix.feed(91,0),ix.feed(92,0)],round=9007199254740993n,closes=round+120n;
const config={feeds:pad(feeds.map(p=>p.toBase58()),PublicKey.default.toBase58()),max_stale_slots:pad([240,360,480]),risk_bps:pad([500,1000,1500]),caps_bps:pad([5000,5000,5000]),categories:pad([0,1,1]),category_caps_bps:[10000,7500,0,0],risk_screen_bps:6000,min_consumers:1,max_round_slots:360,consumers:[operator.toBase58()]};
const kitConfig={feeds:config.feeds.map(address),maxStaleSlots:config.max_stale_slots,riskBps:config.risk_bps,capsBps:config.caps_bps,categories:Uint8Array.from(config.categories),categoryCapsBps:config.category_caps_bps,riskScreenBps:config.risk_screen_bps,minConsumers:config.min_consumers,maxRoundSlots:config.max_round_slots,consumers:config.consumers.map(address)};
const common={registry:a(ix.registry()),policy:a(ix.policy()),consensus:a(ix.allocationPda(round)),roundContext:a(ix.context(round)),allocationState:a(ix.allocationState())};
function parity(name,kit,anchor){assert.equal(kit.programAddress,ix.program.toBase58());assert(Buffer.from(kit.data).equals(anchor.data),`${name} data bytes`);assert.deepEqual(kit.accounts.map(m=>({pubkey:m.address,isSigner:isSignerRole(m.role),isWritable:isWritableRole(m.role)})),anchor.keys.slice(0,kit.accounts.length).map(m=>({...m,pubkey:m.pubkey.toBase58()})));console.log('PASS',name);}
parity('init_allocation_policy',sdk.getInitAllocationPolicyInstruction({...common,admin:signer(admin),config:kitConfig}),ix.configure(admin,config));
parity('update_allocation_policy',sdk.getUpdateAllocationPolicyInstruction({...common,admin:signer(admin),config:kitConfig}),ix.configure(admin,config,true));
parity('open_allocation_round_v2',sdk.getOpenAllocationRoundV2Instruction({...common,admin:signer(admin),round,closesAtSlot:closes,rule:1,trimPct:0}),ix.openV2(admin,round,closes,feeds));
const weights=pad([5000,2000,3000]),hash=Uint8Array.from({length:32},(_,i)=>i);
parity('submit_weights_v2',sdk.getSubmitWeightsV2Instruction({...common,operator:signer(operator),round,weights,inputHash:hash}),ix.submitV2(operator,round,weights,hash));
parity('finalize_allocation_v2',sdk.getFinalizeAllocationV2Instruction({...common,cranker:signer(operator),round}),ix.finalizeV2(operator,round));
parity('close_allocation_round_v2',sdk.getCloseAllocationRoundV2Instruction({...common,admin:signer(admin),round}),ix.closeV2(admin,round));
assert.equal(await sdk.getAllocationPolicyAddress(),ix.policy().toBase58());assert.equal(await sdk.getRoundContextAddress(round),ix.context(round).toBase58());console.log('All six v2 SDK instructions and new PDA helpers match.');
