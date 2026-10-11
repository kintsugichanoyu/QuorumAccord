import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDelay, startRpcGateway } from '../../src/rpc-gateway.js';

test('RPC pacing honours Retry-After seconds, dates and bounded backoff', () => {
  assert.equal(retryDelay('3', 0, 1000), 3000);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:05 GMT', 0, 1000, 1000), 4000);
  assert.equal(retryDelay(null, 2, 1000), 4000);
  assert.equal(retryDelay('invalid', 0, 1000), 1000);
  assert.equal(retryDelay('900', 0, 1000), 30_000);
});
test('RPC gateway serializes requests and preserves signed bytes and chain responses', async () => {
  const observed: { body: string; at: number }[] = [];
  const gateway = await startRpcGateway('https://unused.example', { intervalMs: 20, methodIntervalMs: 30,
    fetch: async (_url, init) => {
      observed.push({ body: String(init?.body), at: Date.now() });
      return new Response('{"jsonrpc":"2.0","result":"real-response","id":1}', { status: 200 });
    },
  });
  try {
    const body = '{"jsonrpc":"2.0","method":"sendTransaction","params":["signed-bytes"],"id":1}';
    const replies = await Promise.all([0, 1, 2].map(async () => (await fetch(gateway.url, { method: 'POST', body })).text()));
    assert(replies.every(r => r.includes('real-response')));
    assert(observed.every(r => r.body === body));
    assert(observed[1]!.at - observed[0]!.at >= 25);
    assert(observed[2]!.at - observed[1]!.at >= 25);
    assert.equal(gateway.stats.requests, 3);
  } finally { await gateway.close(); }
});
test('RPC gateway retries throttling without changing the transaction payload', async () => {
  const bodies: string[] = [];
  const gateway = await startRpcGateway('https://unused.example', { intervalMs: 0, methodIntervalMs: 0, retryBaseMs: 1,
    fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      return bodies.length === 1 ? new Response('limited', { status: 429, headers: { 'retry-after': '0' } })
        : new Response('{"result":123}', { status: 200 });
    },
  });
  try {
    const body = '{"jsonrpc":"2.0","method":"getSlot","id":1}';
    const response = await fetch(gateway.url, { method: 'POST', body });
    assert.equal(response.status, 200);
    assert.deepEqual(bodies, [body, body]);
    assert.equal(gateway.stats.rate_limit_retries, 1);
  } finally { await gateway.close(); }
});
test('RPC gateway exposes persistent upstream failures and rejects invalid requests', async () => {
  const gateway = await startRpcGateway('https://unused.example', { intervalMs: 0, methodIntervalMs: 0, retries: 0,
    fetch: async () => new Response('still limited', { status: 429 }),
  });
  try {
    assert.equal((await fetch(gateway.url)).status, 405);
    assert.equal((await fetch(gateway.url, { method: 'POST', body: '{}' })).status, 400);
    const response = await fetch(gateway.url, { method: 'POST', body: '{"jsonrpc":"2.0","method":"getSlot"}' });
    assert.equal(response.status, 429);
    assert.equal(await response.text(), 'still limited');
  } finally { await gateway.close(); }
});
test('slow responses do not serialize independent request completions', async () => {
  const starts: number[]=[];
  let release!:()=>void;
  const blocked=new Promise<void>(r=>{release=r;});
  const gateway=await startRpcGateway('https://unused.example',{intervalMs:10,methodIntervalMs:10,fetch:async(_url,init)=>{
    const request=JSON.parse(String(init?.body));starts.push(Date.now());
    if(request.method==='getBalance')await blocked;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:request.method}));
  }});
  try{
    const slow=fetch(gateway.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance'})});
    await new Promise(r=>setTimeout(r,30));
    const fast=await fetch(gateway.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:2,method:'getSlot'})});
    assert.equal((await fast.json()).result,'getSlot');assert.equal(starts.length,2);
    release();assert.equal((await(await slow).json()).result,'getBalance');
  }finally{release();await gateway.close();}
});
test('identical in-flight reads share response data and retain each caller id', async()=>{
  let calls=0;
  const gateway=await startRpcGateway('https://unused.example',{intervalMs:0,methodIntervalMs:0,fetch:async(_url,init)=>{
    calls++;await new Promise(r=>setTimeout(r,40));const request=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{context:{slot:42},value:'chain-bytes'}}));
  }});
  try{
    const responses=await Promise.all([11,12,13].map(async id=>(await fetch(gateway.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',method:'getAccountInfo',params:['pda',{commitment:'confirmed'}],id})})).json()));
    assert.equal(calls,1);assert.deepEqual(responses.map(r=>r.id),[11,12,13]);assert(responses.every(r=>r.result.context.slot===42));assert.equal(gateway.stats.cache_hits,2);
  }finally{await gateway.close();}
});
