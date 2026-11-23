import test from 'node:test';
import assert from 'node:assert/strict';
import {selectProductionRechecks} from '../web/office/ms-production-queue-selection.mjs';

const candidates=[
  {status:'incomplete'},{status:'incomplete'},
  ...Array.from({length:11},()=>({status:'unverified'}))
];
test('always check incomplete candidates before uncertain historical tasks',()=>{
  assert.deepEqual(selectProductionRechecks(candidates,0,6),
    [0,1,2,3,4,5]);
});
test('rotate uncertain candidates fairly across refresh intervals',()=>{
  const first=selectProductionRechecks(candidates,0,6);
  const next=selectProductionRechecks(candidates,300000,6);
  assert.deepEqual(next.slice(0,2),[0,1]);
  assert.notDeepEqual(first.slice(2),next.slice(2));
  const reached=new Set();
  for(let n=0;n<11;n++)
    for(const index of selectProductionRechecks(candidates,n*300000,6).slice(2))
      reached.add(index);
  assert.equal(reached.size,11);
});
test('never assume complete tasks require recheck',()=>{
  assert.deepEqual(selectProductionRechecks(
    [{status:'complete'},{status:'unverified'}],0,6),[1]);
});
test('invalid request budget fails closed',()=>{
  assert.throws(()=>selectProductionRechecks(candidates,0,100),
    /invalid_production_recheck_selection/);
});
