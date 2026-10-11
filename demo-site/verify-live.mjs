import assert from 'node:assert/strict';
import {chromium} from '../frontend/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('qa',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:18880/',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('#snapshot-check')?.textContent==='Verified',{timeout:60000});
await page.locator('#pause').click();assert.match(await page.locator('#connection-text').textContent(),/paused/);
await page.screenshot({path:'qa/overview-desktop.png',fullPage:true});
await page.locator('[data-tab="proof"]').click();assert.equal(await page.locator('#consumed-inputs tr').count(),3);assert.equal(await page.locator('.vote-card').count(),3);
const proof=JSON.parse(await page.locator('#raw-proof').textContent());assert.equal(proof.hash_verified,true);assert.equal(proof.consensus.count,3);assert.equal(proof.allocation_state.weights.reduce((a,b)=>a+b,0),10000);
await page.locator('#load-transactions').click();await page.waitForSelector('[data-sig]',{timeout:30000});await page.locator('[data-sig]').first().click();await page.waitForFunction(()=>document.querySelector('#transaction-detail')?.textContent.includes('finalize_allocation_v2'),{timeout:30000});await page.screenshot({path:'qa/proof-desktop.png',fullPage:true});
await page.locator('[data-tab="policy"]').click();const slider=page.getByRole('slider',{name:'Marginfi risk discount'});await slider.fill('6000');await slider.dispatchEvent('input');assert.match(await page.locator('#simulation-output').textContent(),/No feasible allocation/);await page.locator('#reset-policy').click();assert.doesNotMatch(await page.locator('#simulation-output').textContent(),/No feasible/);await page.screenshot({path:'qa/policy-desktop.png',fullPage:true});
for(const tab of ['feeds','resilience','fleet']){await page.locator(`[data-tab="${tab}"]`).click();await page.screenshot({path:`qa/${tab}-desktop.png`,fullPage:true});}
assert.match(await page.locator('#fleet-count').textContent(),/15\/15/);assert.equal(await page.locator('#scenario-results .scenario').count(),5);
await page.setViewportSize({width:390,height:844});await page.locator('[data-tab="overview"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'qa/overview-mobile.png',fullPage:true});
// Failure retains the last verified values and explicitly reports the failed read.
await page.route('**/rpc',r=>r.abort());await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#connection-text').textContent.includes('unavailable'),{timeout:30000});assert.equal(await page.locator('#total-weight').textContent(),'100%');
assert.deepEqual(errors,[]);
await page.goto('http://127.0.0.1:18880/pitch.html',{waitUntil:'domcontentloaded'});assert.equal(await page.locator('.slide').count(),15);await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#counter').textContent(),'2 / 15');await page.locator('#notes-toggle').click();assert.equal(await page.locator('.slide:not([hidden]) .notes').isVisible(),true);
await writeFile('qa/verified.json',JSON.stringify({checked_at:new Date().toISOString(),tests:['live hash verification','three decoded consumed inputs','three signed consumers','10000 bps output','transaction instruction and logs','risk-screen infeasibility and reset','five recorded experiments','15 container states','mobile overflow','honest RPC failure','pitch navigation and notes'],errors,published_round:proof.allocation_state.round},null,2));
console.log('Verified live product, proof, simulator, fleet, failure handling and pitch.');await browser.close();
