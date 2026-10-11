import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeights } from './rubric.mjs';
const venue=(apy,extra={})=>({apy_bps:apy,crr_bps:0,cap_bps:10000,stale:false,...extra});
test('largest remainder matches the Rust rubric and preserves zero venues',()=>{
  assert.deepEqual(computeWeights([venue(100),venue(100),venue(100),venue(0)]),[3334,3333,3333,0]);
});
test('cap redistribution is deterministic, totals 10000 and enforces demo caps',()=>{
  const w=computeWeights([venue(699,{cap_bps:5000}),venue(164,{cap_bps:5000}),venue(451,{cap_bps:5000})]);
  assert.deepEqual(w,[5000,1474,3526]);
});
test('staleness and risk screen cannot gain weight in cap redistribution',()=>{
  assert.deepEqual(computeWeights([venue(9000,{stale:true}),venue(8000,{crr_bps:6000}),venue(100)]),[0,0,10000]);
});
test('insufficient surviving caps surface under-allocation',()=>{
  assert.deepEqual(computeWeights([venue(100,{cap_bps:4000}),venue(100,{cap_bps:4000})]),[4000,4000]);
});
