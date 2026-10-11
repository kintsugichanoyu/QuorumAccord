import {chromium} from '../frontend/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('qa',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:18880/',{waitUntil:'domcontentloaded'});await page.waitForTimeout(8000);
await page.screenshot({path:'qa/overview-desktop.png',fullPage:true});console.log('Connection:',await page.locator('#connection-text').textContent());console.log('Errors:',errors);
const publicRPC=await page.evaluate(async()=>{try{const r=await fetch('https://api.devnet.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getGenesisHash'})});return {status:r.status,body:await r.text()};}catch(e){return {error:e.message};}});console.log('Public browser RPC:',publicRPC);
for(const tab of ['feeds','proof','policy','resilience']){await page.locator(`[data-tab="${tab}"]`).click();await page.screenshot({path:`qa/${tab}-desktop.png`,fullPage:true});}
await page.setViewportSize({width:390,height:844});await page.locator('[data-tab="overview"]').click();await page.screenshot({path:'qa/overview-mobile.png',fullPage:true});console.log('Mobile overflow:',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
await writeFile('qa/initial-check.json',JSON.stringify({errors,publicRPC},null,2));await browser.close();
