import {chromium} from '../frontend/node_modules/playwright/index.mjs';
import {copyFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto('http://127.0.0.1:18880/pitch.html',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
await page.pdf({path:'dist/pitch.pdf',width:'16in',height:'9in',printBackground:true,preferCSSPageSize:true});await mkdir('qa/pitch',{recursive:true});
const count=await page.locator('.slide').count();for(let i=0;i<count;i++){await page.evaluate(n=>{[...document.querySelectorAll('.slide')].forEach((s,j)=>s.hidden=j!==n);},i);await page.screenshot({path:`qa/pitch/slide-${String(i+1).padStart(2,'0')}.png`,fullPage:true});}
await copyFile('dist/pitch.pdf','../deployment/devnet/evidence/v2/pitch.pdf');console.log('Exported PDF and',count,'slide previews.');await browser.close();
