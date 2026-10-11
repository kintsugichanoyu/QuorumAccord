import {spawn} from 'node:child_process';
import {open,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {STATE} from './common.mjs';
const pidFile=join(STATE,'fleet-monitor.pid');
try{const pid=Number(await readFile(pidFile,'utf8'));const cmd=await readFile(`/proc/${pid}/cmdline`,'utf8');if(cmd.includes('fleet-status.mjs')){console.log('Fleet monitor already running:',pid);process.exit(0);}}catch{}
const log=await open(join(STATE,'fleet-monitor.log'),'a',0o600);
const child=spawn(process.execPath,[join(import.meta.dirname,'fleet-status.mjs')],{detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await writeFile(pidFile,String(child.pid),{mode:0o600});await log.close();console.log('Started read-only fleet monitor:',child.pid);
