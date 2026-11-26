import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryPage,createMsSalesDirectory} from '../functions/api/orders/ms-sales-directory.js';
import {resolveCounterpartyFromApi} from '../functions/api/orders/ms-sales-counterparties.mjs';
const id='7d3da55a-760f-11f1-0a80-066a00250941';
const row=(type,name)=>({id,name,meta:{type,href:'https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/'+id},phone:'private'});
test('directory returns minimal identity and excludes private fields',async()=>{
 const result=await directoryPage(async path=>{assert.match(path,/^entity\/counterparty\?/);return {meta:{size:1},rows:[row('counterparty','Ozon')]};},'counterparty');
 assert.deepEqual(result,{type:'counterparty',total:1,items:[{id,name:'Ozon',archived:false}],nextOffset:null,complete:true});
});
test('incomplete directory fails closed',async()=>{
 await assert.rejects(directoryPage(async()=>({meta:{size:2},rows:[row('store','Main')]}),'store'),/unverified/);
});
test('counterparty resolver uses fixed origin and exact names',async()=>{
 const calls=[];
 const result=await resolveCounterpartyFromApi({MS_API_TOKEN:'test-token'},{agentName:'Ozon',channelName:'Ozon'},{fetcher:async(url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
  const u=new URL(url);assert.equal(u.origin,'https://api.moysklad.ru');assert.equal(u.searchParams.get('filter'),'name=Ozon');
  return Response.json({meta:{size:1},rows:[row(u.pathname.split('/').pop(),'Ozon')]});
 }});
 assert.equal(calls.length,2);assert.deepEqual(result,{agentId:id,channelId:id,verified:true});
});
test('directory forbids writes and unauthenticated reads',async()=>{
 const handler=createMsSalesDirectory({fetcher:()=>{throw Error('must not fetch');}});
 const url='https://autosklad63-office-staging.pages.dev/api/orders/ms-sales-directory?type=store';
 assert.equal((await handler({request:new Request(url,{method:'POST'}),env:{}})).status,405);
 assert.equal((await handler({request:new Request(url),env:{OFFICE_SESSION_SECRET:'x',OFFICE_ALLOWED_EMAIL:'x',OZON_FINANCE_DB:{},MS_API_TOKEN:'x'}})).status,401);
});
