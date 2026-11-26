import test from 'node:test';
import assert from 'node:assert/strict';
import {readSalesDirectories,salesDirectoryEvidence} from '../functions/api/orders/ms-sales-snapshot.mjs';
const id='7d3da55a-760f-11f1-0a80-066a00250941',now=Date.parse('2026-11-26T09:00:00Z');
const item={id,name:'Ozon',archived:false};
const row=(type,items=[item],age=0)=>({entity_type:type,fetched_at:new Date(now-age).toISOString(),row_count:items.length,items_json:JSON.stringify(items)});
const db=results=>({prepare:()=>({all:async()=>({results})})});
test('only fresh complete snapshots and approved exact names qualify',async()=>{
 const d=await readSalesDirectories(db(['counterparty','saleschannel','organization','store'].map(t=>row(t))),now);
 assert.deepEqual(salesDirectoryEvidence(d,{agentName:'Ozon',channelName:'Ozon'},{store_id:id,organization_id:id}),{agentId:id,channelId:id,verified:true,storeVerified:true,organizationVerified:true,missingDirectories:[]});
 assert.equal(salesDirectoryEvidence(d,null,null).verified,false);
});
test('stale, duplicate, and archived records never qualify',async()=>{
 const d=await readSalesDirectories(db([row('counterparty',[item],21600001),row('saleschannel',[item,item]),row('store',[{...item,archived:true}])]),now);
 const e=salesDirectoryEvidence(d,{agentName:'Ozon',channelName:'Ozon'},{store_id:id});
 assert.equal(e.verified,false);assert.equal(e.storeVerified,false);assert.equal(e.organizationVerified,false);assert.deepEqual(e.missingDirectories,['counterparty','saleschannel','organization']);
});
