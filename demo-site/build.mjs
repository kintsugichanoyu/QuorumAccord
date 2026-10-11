import {build} from 'esbuild';
import {readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
// Keep standalone Site sources in sync when building inside the full repository.
try {await access('../sdk/idl/quorum_allocation.json');await copyFile('../sdk/idl/quorum_allocation.json','src/idl.json');} catch {}
try {const math=await readFile('../deployment/devnet/policy-math.mjs','utf8');await writeFile('src/policy-math.js',math.replace("'./rubric.mjs'","'./rubric.js'"));await copyFile('../deployment/devnet/rubric.mjs','src/rubric.js');} catch {}
await build({entryPoints:['src/app.js'],bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/app.js',inject:['src/buffer-shim.js'],define:{'process.env.NODE_ENV':'"production"'}});
const manifest=JSON.parse(await readFile('.openai/hosting.json'));manifest.static={directory:'dist'};await writeFile('.openai/hosting.json',JSON.stringify(manifest,null,2)+'\n');
