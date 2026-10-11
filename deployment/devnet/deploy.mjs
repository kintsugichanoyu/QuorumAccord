import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';
import { ROOT, STATE, wallet, save, DEVNET_GENESIS } from './common.mjs';

const rpc=process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const payer=resolve(process.env.FUNDING_KEYPAIR ?? join(ROOT,'testing/devnet/.state/keys/admin.json'));
const programPath=resolve(process.env.PROGRAM_KEYPAIR ?? join(ROOT,'testing/devnet/.state/keys/program.json'));
const bufferPath=resolve(process.env.BUFFER_KEYPAIR ?? join(ROOT,'testing/devnet/.state/keys/program-buffer.json'));
const [key,program,buffer]=await Promise.all([wallet(payer),wallet(programPath),wallet(bufferPath)]);
const c=new Connection(rpc,'confirmed');assert.equal(await c.getGenesisHash(),DEVNET_GENESIS);
const source=await readFile(join(ROOT,'programs/quorum-allocation/src/lib.rs'),'utf8');
assert(source.includes(`declare_id!("${program.publicKey.toBase58()}")`),'program key must match declare_id; synchronize and build before deployment');
const path=join(ROOT,'target/deploy/quorum_allocation.so'), elf=await readFile(path);
const old=await c.getAccountInfo(program.publicKey);
if(old) {
  assert(old.executable && old.owner.toBase58()==='BPFLoaderUpgradeab1e11111111111111111111111');
  const data=await c.getAccountInfo(new PublicKey(old.data.subarray(4,36)));
  assert(data && new PublicKey(data.data.subarray(13,45)).equals(key.publicKey),'wrong upgrade authority');
  if(data.data.subarray(45,45+elf.length).equals(elf)) {
    await save(join(STATE,'deployment-check.json'),{programId:program.publicKey.toBase58(),bytecode_matches:true,deployment_slot:data.data.readBigUInt64LE(4)});
    console.log('Existing deployment already matches the SBF build.');process.exit(0);
  }
}
const currentBuffer=await c.getAccountInfo(buffer.publicKey);
const maxLen=Math.ceil(Math.max(elf.length,currentBuffer?currentBuffer.data.length-37:0)/65536)*65536;
const rent=await c.getMinimumBalanceForRentExemption(maxLen+37);
assert(await c.getBalance(key.publicKey)>rent+1000000000,'insufficient devnet SOL for deploy buffer and fleet setup');
await mkdir(STATE,{recursive:true,mode:0o700});
const args=['program','deploy',path,'--url',rpc,'--keypair',payer,'--program-id',programPath,'--buffer',bufferPath,'--max-len',String(maxLen),'--use-tpu-client','--commitment','confirmed','--output','json'];
const result=await new Promise((resolve,reject)=>{
  const child=spawn('solana',args,{cwd:ROOT,stdio:['ignore','pipe','pipe']});let out='',err='';
  child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);
  child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(`deployment failed: ${err}`)));
});
await save(join(STATE,'deployment.json'),result);console.log(JSON.stringify(result));
