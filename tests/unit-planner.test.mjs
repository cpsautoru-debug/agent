import test from 'node:test';
import assert from 'node:assert/strict';
import {planUnit,parseRubles} from '../web/office/unit-planner-core.mjs';
const x={price:890000,cost:370000,platform:178000,logistics:45000,returnsReserve:0,tax:71200,overhead:50000,targetProfit:250000,advertising:44500,costBasis:'manufacturing',expensesSeparated:true};
test('scenario headroom and target are distinct',()=>{const p=planUnit(x);assert.equal(p.beforeAds,175800);assert.equal(p.profit,131300);assert.equal(p.targetFeasible,false);assert.equal(p.maxAds,0);assert.equal(p.breakEvenAds,175800);assert.equal(p.targetMet,false);});
test('full cost cannot duplicate overhead',()=>{assert.equal(planUnit({...x,costBasis:'full'}),null);assert.equal(planUnit({...x,costBasis:'full',cost:420000,overhead:0}).profit,131300);});
test('explicit inputs required',()=>{assert.equal(planUnit({...x,tax:null}),null);assert.equal(planUnit({...x,expensesSeparated:false}),null);assert.equal(parseRubles(''),null);assert.equal(parseRubles('1,25'),125);assert.equal(parseRubles('0'),0);assert.equal(parseRubles('-1'),null);});
test('positive target headroom and loss boundary',()=>{const p=planUnit({...x,targetProfit:100000});assert.equal(p.maxAds,75800);assert.equal(p.targetMet,true);assert.equal(planUnit({...x,cost:900000}).breakEvenFeasible,false);});
