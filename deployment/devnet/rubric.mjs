// Integer-only port of workers/rubric/src/lib.rs, including cap redistribution.
export function computeWeights(venues, maxCrr=6000n) {
  const raw=venues.map(v=>v.stale || BigInt(v.crr_bps)>=maxCrr ? 0n : BigInt(v.apy_bps)*(10000n-BigInt(v.crr_bps))/10000n);
  const sum=raw.reduce((a,b)=>a+b,0n); if(!sum) return venues.map(()=>0);
  const weights=raw.map(r=>Number(r*10000n/sum));
  let left=10000-weights.reduce((a,b)=>a+b,0);
  const rank=raw.map((r,i)=>({i,rem:r*10000n%sum})).sort((a,b)=>a.rem>b.rem?-1:a.rem<b.rem?1:a.i-b.i);
  for(const r of rank) if(left>0 && raw[r.i]>0n) {weights[r.i]++;left--;}
  for(let pass=0;pass<16;pass++) {
    let excess=0; for(let i=0;i<weights.length;i++) if(weights[i]>venues[i].cap_bps) {excess+=weights[i]-venues[i].cap_bps;weights[i]=venues[i].cap_bps;}
    if(!excess) break;
    const room=weights.map((w,i)=>raw[i]>0n && !venues[i].stale ? Math.max(0,venues[i].cap_bps-w):0);
    const total=room.reduce((a,b)=>a+b,0); if(!total) break;
    let distributed=0;
    const capsRank=room.map((h,i)=>({i,rem:BigInt(h)*BigInt(excess)%BigInt(total)})).filter(r=>room[r.i]>0).sort((a,b)=>a.rem>b.rem?-1:a.rem<b.rem?1:a.i-b.i);
    for(let i=0;i<weights.length;i++) {const add=Math.min(room[i],Math.floor(excess*room[i]/total));weights[i]+=add;distributed+=add;}
    let remaining=excess-distributed;
    for(const r of capsRank) if(remaining>0 && weights[r.i]<venues[r.i].cap_bps) {weights[r.i]++;remaining--;}
  }
  return weights;
}
