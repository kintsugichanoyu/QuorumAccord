import assert from 'node:assert/strict';
import {copyFile,chmod,mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import {startRpcGateway} from '../../testing/devnet/dist/src/rpc-gateway.js';
import {ROOT,STATE,save,load,wallet,client,send,account,journal,decodeRegistry,decodeFeed,decodeAllocation} from './common.mjs';
import {decodePolicy} from './policy-codec.mjs';
import {readSources,BINDINGS,USDC} from './sources.mjs';
process.umask(0o077);
const adminPath=resolve(process.env.FUNDING_KEYPAIR??join(ROOT,'testing/devnet/.state/keys/admin.json'));
const programPath=resolve(process.env.PROGRAM_KEYPAIR??join(ROOT,'testing/devnet/.state/keys/program.json'));
const rpc=process.env.DEVNET_RPC_URL??'https://api.devnet.solana.com';
const admin=await wallet(adminPath),program=await wallet(programPath);
await mkdir(join(STATE,'keys'),{recursive:true,mode:0o700});
const producers=[],consumers=[],keys=[];
async function ensureKey(role,existing){const path=join(STATE,'keys',`${role}.json`);if(!await load(path,null)){if(existing && await load(existing,null))await copyFile(existing,path);else await save(path,[...Keypair.generate().secretKey]);}await chmod(path,0o600);const key=await wallet(path);keys.push({role,key});return key.publicKey.toBase58();}
for(let venue=0;venue<3;venue++)for(let operator=1;operator<=3;operator++){
 const role=`producer-${BINDINGS[venue].name.toLowerCase()}-${operator}`;
 producers.push({role,venue,operator,key:await ensureKey(role,venue===0?join(STATE,'keys',`oracle-${operator}.json`):undefined)});
}
for(let operator=1;operator<=3;operator++){const role=`consumer-${operator}`;consumers.push({role,operator,key:await ensureKey(role)});}
await copyFile(adminPath,join(STATE,'keys','coordinator.json'));await chmod(join(STATE,'keys','coordinator.json'),0o600);
const cadences=(process.env.FEED_WINDOWS??'120,180,240').split(',').map(Number);
assert(cadences.length===3&&cadences.every(n=>Number.isSafeInteger(n)&&n>=120&&n<=100000),'FEED_WINDOWS requires three widths >=120');
const config={schema_version:2,network:'devnet',rpc_url:rpc,source_rpc_url:process.env.SOURCE_RPC_URL??'https://api.mainnet-beta.solana.com',program_id:program.publicKey.toBase58(),admin:admin.publicKey.toBase58(),producers,consumers,operators:producers.map(p=>p.key),mint:USDC,asset:'USDC',sample_quorum:3,allocation_quorum:3,
 risk_discount_bps:[500,1000,1500],caps_bps:[5000,5000,5000],categories:[0,1,1],category_caps_bps:[10000,7500,0,0],category_names:['Independent lending','Shared demo category'],round_vote_slots:120,max_round_slots:360,
 feeds:BINDINGS.map((b,i)=>({...b,pool_id:90+i,data_id:0,window_slots:cadences[i],stale_slots:cadences[i]*2})),consumer_uses_registry_admin:false};
await save(join(STATE,'config.json'),config);
const gateway=await startRpcGateway(rpc);
try{
 const c=await client(gateway.url,adminPath);
 const a=await c.connection.getAccountInfo(c.ix.program);assert(a?.executable&&a.owner.toBase58()==='BPFLoaderUpgradeab1e11111111111111111111111','deploy program first');
 const programData=new PublicKey(a.data.subarray(4,36)),deployed=await c.connection.getAccountInfoAndContext(programData);
 assert(deployed.value&&deployed.value.data[12]===1&&new PublicKey(deployed.value.data.subarray(13,45)).equals(admin.publicKey),'wrong upgrade authority');
 const elf=await readFile(join(ROOT,'target/deploy/quorum_allocation.so'));assert(deployed.value.data.subarray(45,45+elf.length).equals(elf),'on-chain binary differs from local build');
 await journal({event:'deployment_verified',program_id:config.program_id,program_data:programData.toBase58(),deployment_slot:deployed.value.data.readBigUInt64LE(4),context_slot:deployed.context.slot,bytecode_matches:true});
 await journal({event:'sources_verified',source:await readSources(config.source_rpc_url)});
 const registry=await account(c,c.ix.registry(),decodeRegistry);
 if(registry)assert.equal(new PublicKey(Buffer.from(registry.raw_base64,'base64').subarray(8,40)).toBase58(),config.admin);else await send(c,c.ix.initRegistry(admin.publicKey),'initialize registry');
 for(const {role,key} of keys){const target=role.startsWith('producer')?Number(process.env.PRODUCER_FUND_SOL??'0.12')*1e9:Number(process.env.CONSUMER_FUND_SOL??'0.04')*1e9;assert(Number.isSafeInteger(target)&&target>=10000000);const balance=await c.connection.getBalance(key.publicKey);if(balance<target)await send(c,SystemProgram.transfer({fromPubkey:admin.publicKey,toPubkey:key.publicKey,lamports:target-balance}),`fund ${role} from existing devnet wallet`);}
 const registered=(await account(c,c.ix.registry(),decodeRegistry)).decoded;
 for(const {role,key} of keys)if(!registered.includes(key.publicKey.toBase58()))await send(c,c.ix.addOperator(admin.publicKey,key.publicKey),`register ${role}`);
 for(const f of config.feeds){const old=await account(c,c.ix.feed(f.pool_id,0),decodeFeed);const fc={window_slots:f.window_slots,threshold_bps:1,min_interval_slots:f.window_slots,max_interval_slots:f.window_slots,min_number:3,rule:1,trim_pct:0,measurand:0};await send(c,old?c.ix.updateFeed(admin.publicKey,f.pool_id,0,fc):c.ix.initFeed(admin.publicKey,f.pool_id,0,fc),`${old?'configure':'initialize'} ${f.name} feed; ${f.window_slots} slots`);}
 if(!await account(c,c.ix.allocationState(),decodeAllocation))await send(c,c.ix.initAllocation(admin.publicKey),'initialize AllocationState');
 const pad=(xs,v=0)=>[...xs,...Array(16-xs.length).fill(v)];
 const policy={feeds:pad(config.feeds.map(f=>c.ix.feed(f.pool_id,0).toBase58()),PublicKey.default.toBase58()),max_stale_slots:pad(config.feeds.map(f=>f.stale_slots)),risk_bps:pad(config.risk_discount_bps),caps_bps:pad(config.caps_bps),categories:pad(config.categories),category_caps_bps:config.category_caps_bps,risk_screen_bps:6000,min_consumers:3,max_round_slots:config.max_round_slots,consumers:consumers.map(p=>p.key)};
 await send(c,c.ix.configure(admin.publicKey,policy,!!await account(c,c.ix.policy(),decodePolicy)),'configure frozen-input allocation policy; 3 consumer quorum');
 await journal({event:'setup_complete',registry:await account(c,c.ix.registry(),decodeRegistry),feeds:await Promise.all(config.feeds.map(f=>account(c,c.ix.feed(f.pool_id,0),decodeFeed))),allocation_state:await account(c,c.ix.allocationState(),decodeAllocation),policy:await account(c,c.ix.policy(),decodePolicy)});
 const publicConfig={...config,rpc_url:'https://api.devnet.solana.com',source_rpc_url:undefined,admin:undefined,registry:c.ix.registry().toBase58(),allocation_state:c.ix.allocationState().toBase58(),policy:c.ix.policy().toBase58(),feeds:config.feeds.map(f=>({...f,pda:c.ix.feed(f.pool_id,0).toBase58()}))};
 await save(join(ROOT,'demo-site/dist/config.json'),publicConfig);
}finally{await gateway.close();}
console.log('Configured nine single-feed producers, three consumers and a separate coordinator.');
