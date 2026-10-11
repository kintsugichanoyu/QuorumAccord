import {computeWeights} from './rubric.mjs';
export function validPolicyWeights(weights,config,eligible) {
 if(weights.length!==16 || weights.some(x=>!Number.isInteger(x)||x<0) || weights.reduce((a,b)=>a+b,0)!==10000)return false;
 const totals=[0,0,0,0];
 for(let i=0;i<16;i++){if(weights[i]>config.caps_bps[i]||(!eligible[i]&&weights[i]))return false;totals[config.categories[i]]+=weights[i];}
 return totals.every((n,i)=>n<=config.category_caps_bps[i]);
}
export function constrainWeights(raw,config,eligible) {
 const active=raw.map((v,i)=>!!eligible[i]&&v>0),w=raw.map((v,i)=>active[i]?Math.min(v,config.caps_bps[i]):0);
 for(let cat=0;cat<4;cat++) {
  let excess=Math.max(0,w.reduce((s,v,i)=>s+(config.categories[i]===cat?v:0),0)-config.category_caps_bps[cat]);
  while(excess){const ids=w.map((v,i)=>i).filter(i=>config.categories[i]===cat&&w[i]>0).sort((a,b)=>w[b]-w[a]||a-b);if(!ids.length)return null;const i=ids[0],n=Math.min(excess,w[i]);w[i]-=n;excess-=n;}
 }
 let sum=w.reduce((a,b)=>a+b,0);
 while(sum>10000){const i=w.map((_,i)=>i).sort((a,b)=>w[b]-w[a]||a-b)[0],n=Math.min(sum-10000,w[i]);w[i]-=n;sum-=n;}
 for(let step=0;step<21;step++) {
  if(sum===10000)return validPolicyWeights(w,config,eligible)?w:null;
  const totals=[0,0,0,0];w.forEach((v,i)=>totals[config.categories[i]]+=v);
  const ids=w.map((_,i)=>i).filter(i=>active[i]&&config.caps_bps[i]>w[i]&&config.category_caps_bps[config.categories[i]]>totals[config.categories[i]]).sort((a,b)=>w[a]-w[b]||a-b);
  if(!ids.length)return null;const i=ids[0],cat=config.categories[i];
  const n=Math.min(10000-sum,config.caps_bps[i]-w[i],config.category_caps_bps[cat]-totals[cat]);w[i]+=n;sum+=n;
 }
 return null;
}
export function computeSnapshot(snapshot) {
 const cfg=snapshot.config;
 const inputs=snapshot.values.map((apy_bps,i)=>({apy_bps,crr_bps:cfg.risk_bps[i],cap_bps:cfg.caps_bps[i],stale:!snapshot.eligible[i]}));
 const initial=computeWeights(inputs,BigInt(cfg.risk_screen_bps));
 return {inputs,weights:constrainWeights(initial,cfg,snapshot.eligible)};
}
