import test from 'node:test';
import assert from 'node:assert/strict';
import {syncDirectoryType} from '../workers/ms-sales-directory-sync.mjs';
const secret='a'.repeat(43),now=()=>1795676400000;
function fixture(){const writes=[];return {writes,db:{prepare(sql){return {bind(...args){return {run:async()=>writes.push({sql,args})};}};}}};}
const item={id:'7d3da55a-760f-11f1-0a80-066a00250941',name:'Main',archived:false};
test('only complete snapshots are stored',async()=>{
 const {db,writes}=fixture();
 const result=await syncDirectoryType({db,secret,type:'store',now,fetcher:async(url,options)=>{
 assert.equal(new URL(url).pathname,'/api/ms/sales-bridge');assert.equal(options.method,'GET');assert.match(options.headers['X-MS-Bridge-Signature'],/^[a-f0-9]{64}$/);
 return Response.json({code:'sales_directory_ok',readOnly:true,type:'store',total:1,items:[item],nextOffset:null});
 }});
 assert.equal(result.count,1);assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].args[3]),[item]);
});
test('incomplete or unauthorized data does not replace snapshot',async()=>{
 for(const response of [()=>Response.json({code:'sales_directory_ok',readOnly:true,type:'store',total:2,items:[item],nextOffset:null}),()=>new Response(null,{status:401})]){
 const {db,writes}=fixture();await assert.rejects(syncDirectoryType({db,secret,type:'store',now,fetcher:async()=>response()}));assert.equal(writes.length,0);
 }
});
