import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointReader,projectPage} from '../functions/api/orders/fulfillment-checkpoint.mjs';
test('resumes from successful checkpoints and retries errors without consuming the cursor',async()=>{
 const saved=new Map();
 let calls=0;
 const upstream=async key=>{
  calls++;
  if(calls===2)throw Error('temporary');
  return {meta:{size:0},rows:[],secret:key};
 };
 let read=checkpointReader(saved,async(k,data)=>saved.set(k,data),upstream,2);
 await read('entity/customerorder?offset=0');
 await assert.rejects(read('entity/customerorder?offset=10'),/temporary/);
 await assert.rejects(read('entity/customerorder?offset=10'),/checkpoint_pending/);
 read=checkpointReader(saved,async(k,data)=>saved.set(k,data),upstream,1);
 await read('entity/customerorder?offset=0');
 await read('entity/customerorder?offset=10');
 assert.equal(calls,3);
 assert.equal(saved.size,2);
});
test('saved page contains only fulfillment evidence',()=>{
 const data=projectPage({meta:{size:1},rows:[{id:'order',name:'buyer',description:'address',
  agent:{name:'person'},updated:'version',state:{stateType:'Regular',name:'state'}}]});
 assert.deepEqual(data,{meta:{size:1},rows:[{id:'order',updated:'version',state:{stateType:'Regular'}}]});
});
