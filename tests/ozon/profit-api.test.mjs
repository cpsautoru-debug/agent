import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
const asModule=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const sources=new Map();
async function moduleUrl(path){const url=new URL(path,import.meta.url);if(sources.has(url.href))return sources.get(url.href);let source=await readFile(url,'utf8');const matches=[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)];for(const match of matches){if(match[1].startsWith('.')){const nested=new URL(match[1],url);source=source.replace(match[0],`from ${JSON.stringify(await moduleUrl(nested.href))}`);}}const data=asModule(source);sources.set(url.href,data);return data;}
const route=await import(await moduleUrl('../../functions/api/ozon/profit.js'));
const store=await import(await moduleUrl('../../workers/ozon-profit-store.js'));
const oldCosts=await import(await moduleUrl('../../functions/api/ozon/costs.js'));
async function cookie(sub='owner'){
 const now=Math.floor(Date.now()/1000),payload=Buffer.from(JSON.stringify({sub,iat:now,exp:now+28800})).toString('base64url');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');return '__Host-office_session='+payload+'.'+signature;
}
async function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(await readFile(new URL('../../migrations/0004_ozon_profit.sql',import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})}},first:async()=>sqlite.prepare(sql).get()||null}}};
 const target=store.TEST_PROFIT_DATABASE_ID;
 const env={OFFICE_SESSION_SECRET:'test-secret',OFFICE_ALLOWED_EMAIL:'owner@example.test',OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/office_authorized_users/);assert.doesNotMatch(sql,/ozon_profit_state|ozon_api_accrual/);return {bind(sub,email){assert.equal(email,'owner@example.test');return {first:async()=>sub==='owner'?{allowed:1}:null}}}}},OZON_FINANCE_SYNC:{
  async getProfitData(month){return {...await store.getProfitDocuments(db,target,month),api:{totalKopecks:null,records:null,coveredDays:0,days:31,netVerified:false,detailVerified:false,components:[],audit:[]}}},
  async getProfitDocument(key){return {...await store.getProfitDocument(db,target,key),target}},
  async confirmProfitDocument(change){return store.confirmProfitDocument(db,target,change)}
 }};
 const req=async(body,options={})=>new Request('https://office.example/api/ozon/profit?month=2026-10',{method:body?'POST':'GET',headers:{Cookie:await cookie(options.sub),...(body?{'Origin':options.origin||'https://office.example','Content-Type':options.type||'application/json'}:{}),...options.headers},...(body?{body:JSON.stringify(body)}:{})});
 return {sqlite,env,req};
}
const value={entries:[{sku:'synthetic',costKopecks:12345,validFrom:'2026-10-01',validTo:null,status:'confirmed',source:'test evidence',leatherDeliveryIncluded:false}]};
test('owner API rejects anonymous, non-owner, foreign origin and unsupported media without finance writes',async()=>{
 const {sqlite,env,req}=await setup();
 assert.equal((await route.onRequestGet({env,request:new Request('https://office.example/api/ozon/profit?month=2026-10')})).status,401);
 assert.equal((await route.onRequestGet({env,request:await req(null,{sub:'other'})})).status,403);
 assert.equal((await route.onRequestPost({env,request:await req({action:'preview',key:'costs',value},{origin:'https://evil.example'})})).status,403);
 assert.equal((await route.onRequestPost({env,request:await req({},{type:'text/plain'})})).status,415);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM ozon_profit_audit').get().n,0);sqlite.close();
});
test('owner preview and confirm persist only through finance service, protect stale and changed data',async()=>{
 const {sqlite,env,req}=await setup();
 const previewResponse=await route.onRequestPost({env,request:await req({action:'preview',key:'costs',value})});assert.equal(previewResponse.status,200);
 const preview=await previewResponse.json();assert.equal(preview.before,null);assert.equal(sqlite.prepare('SELECT count(*) n FROM ozon_profit_state').get().n,0);
 const tampered=await route.onRequestPost({env,request:await req({action:'confirm',key:'costs',value:{entries:[]},token:preview.token})});assert.equal(tampered.status,409);
 const confirm={action:'confirm',key:'costs',value,token:preview.token};
 assert.equal((await route.onRequestPost({env,request:await req(confirm)})).status,200);
 assert.equal((await route.onRequestPost({env,request:await req(confirm)})).status,409);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM ozon_profit_audit').get().n,1);sqlite.close();
});
test('empty coverage is readable and leaves unsupported profit unknown; wrong finance target refuses response',async()=>{
 const {sqlite,env,req}=await setup();
 const response=await route.onRequestGet({env,request:await req()});assert.equal(response.status,200);const data=await response.json();assert.equal(data.result.profit.netEstimateKopecks,null);assert.equal(data.result.api.totalKopecks,null);assert.equal(response.headers.get('Cache-Control'),'no-store');
 env.OZON_FINANCE_SYNC.getProfitData=async()=>({target:'main-db'});
 assert.equal((await route.onRequestGet({env,request:await req()})).status,503);sqlite.close();
});
test('legacy costs POST cannot bypass preview-confirm workflow',async()=>{
 const {sqlite,env,req}=await setup();
 const response=await oldCosts.onRequestPost({env,request:await req({sku:'synthetic',sellerArticle:'article',model:'model',costKopecks:200,status:'confirmed',source:'owner'})});
 assert.equal(response.status,409);assert.match((await response.json()).error,/preview/i);sqlite.close();
});
test('streamed oversized JSON is refused before normalization or persistence',async()=>{
 const {sqlite,env}=await setup();
 const request=new Request('https://office.example/api/ozon/profit',{method:'POST',headers:{Cookie:await cookie(),Origin:'https://office.example','Content-Type':'application/json'},body:' '.repeat(1500001)});
 assert.equal((await route.onRequestPost({env,request})).status,413);assert.equal(sqlite.prepare('SELECT count(*) n FROM ozon_profit_state').get().n,0);sqlite.close();
});
