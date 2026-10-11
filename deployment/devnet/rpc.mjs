import {startRpcGateway} from '../../testing/devnet/dist/src/rpc-gateway.js';
import {load,STATE,heartbeat,pause} from './common.mjs';
import {join} from 'node:path';
const config=await load(process.env.FLEET_CONFIG??join(STATE,'config.json'));
const gateway=await startRpcGateway(config.rpc_url,{host:'0.0.0.0',port:8799,intervalMs:250,methodIntervalMs:550});
console.log('Independent devnet RPC gateway listening on 8799');
while(true){await heartbeat({rpc:gateway.stats});await pause(10000);}
