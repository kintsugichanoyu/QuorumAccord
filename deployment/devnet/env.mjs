import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {STATE,load} from './common.mjs';
process.umask(0o077);
const config=await load(join(STATE,'config.json'));
await mkdir(join(STATE,'control'),{recursive:true,mode:0o700});
for(const role of ['rpc','coordinator',...config.producers.map(p=>p.role),...config.consumers.map(p=>p.role)]){
 await mkdir(join(STATE,'runtime',role),{recursive:true,mode:0o700});
 await writeFile(join(STATE,`${role}.env`),[`ROLE=${role}`,'FLEET_STATE=/state','FLEET_CONFIG=/state/config.json',...(role==='rpc'?[]:['KEYPAIR_FILE=/run/secrets/operator.json']),'RPC_URL=http://rpc:8799',`POLL_MS=${role.startsWith('producer')?9000:6000}`,''].join('\n'),{mode:0o600});
}
