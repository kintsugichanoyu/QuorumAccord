import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(process.env.WEB_ROOT??'../../demo-site/dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.pdf':'application/pdf','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const allowed=new Set(['getGenesisHash','getSlot','getAccountInfo','getMultipleAccounts','getSignaturesForAddress','getTransaction','getSignatureStatuses']);
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/health'){res.writeHead(200);res.end('ok');return;}
  if(url.pathname==='/rpc'&&req.method==='POST'){
   let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>65536){res.writeHead(413);res.end();return;}chunks.push(c);}
   const body=JSON.parse(Buffer.concat(chunks));if(Array.isArray(body)||!allowed.has(body.method)){res.writeHead(403);res.end('read-only RPC');return;}
   const upstream=await fetch(process.env.RPC_URL??'http://127.0.0.1:18789',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   res.writeHead(upstream.status,{'content-type':'application/json','cache-control':'no-store'});res.end(await upstream.text());return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  const info=await stat(file);if(!info.isFile())throw Error('not a file');
  res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:await readFile(file));
 }catch(e){res.writeHead(404,{'content-type':'text/plain'});res.end('Not found');}
}).listen(8080,'0.0.0.0',()=>console.log('Read-only demo on :8080'));
