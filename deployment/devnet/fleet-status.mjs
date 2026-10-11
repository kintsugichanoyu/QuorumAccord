// Read-only host monitor. No Docker socket or signing key is exposed to the web container.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {chmod} from 'node:fs/promises';
import {ROOT,STATE,load,save,pause} from './common.mjs';
const run=promisify(execFile),path=join(ROOT,'demo-site/dist/fleet.json');
const config=await load(join(STATE,'config.json'));
while(true){
 try{
  const {stdout}=await run('sudo',['-n','docker','compose','-f',join(import.meta.dirname,'compose.yaml'),'ps','--all','--format','json']);
  const rows=stdout.trim().startsWith('[')?JSON.parse(stdout):stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  const services=[];
  for(const row of rows){const health=await load(join(STATE,'runtime',row.Service,'health.json'),null);const definition=[...config.producers,...config.consumers].find(p=>p.role===row.Service);services.push({service:row.Service,name:row.Name,state:row.State,health:row.Health,status:row.Status,role:row.Service.startsWith('producer')?'producer':row.Service.startsWith('consumer')?'consumer':'support',wallet:definition?.key??null,venue:definition?.venue!==undefined?config.feeds[definition.venue].name:null,heartbeat_at:health?new Date(health.at).toISOString():null,last_worker_slot:health?.slot??null});}
  await save(path,{checked_at:new Date().toISOString(),source:'Host Docker Compose ps plus mounted worker heartbeats',services});await chmod(path,0o644);
 }catch(e){console.error('Fleet monitor:',e.message);}
 if(process.argv.includes('--once'))break;await pause(15000);
}
