import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({load(url,ctx,next){if(url.includes('/functions/api/')&&url.endsWith('.js'))return {...next(url,{...ctx,format:'module'}),format:'module'};return next(url,ctx)}});
const {createSavedReportHandlers}=await import('../../functions/api/wb/saved-report.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const fixture={status:'XLSX_LOCAL_PREFLIGHT_UNVERIFIED',dataVerified:false,sourceRows:2,sales:1,returns:0,skuCount:1,payoutRub:'100.00',assumedTaxBaseRub:'100.00',assumedAusn8Rub:'8.00',counts:[{sku:'synthetic-vesta',sales:1,returns:0}]};
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../../migrations/wb/0004_wb_saved_xlsx_reports.sql',import.meta.url),'utf8'));
 const db={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)??null},async run(){const r=sql.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}}}}}}}};
 const auth={prepare(q){assert.match(q,/^SELECT 1 AS allowed/);return {bind(sub){return {async first(){return sub==='owner'?{allowed:1}:null}}}}}};
 const env={OFFICE_SESSION_SECRET:'synthetic-secret',OFFICE_ALLOWED_EMAIL:'owner@example.invalid',OZON_FINANCE_DB:auth,WB_REPORT_SNAPSHOT_DB:db,WB_REPORT_ACCOUNT_ID:'synthetic-account',WB_REPORT_SAVE_MODE:'test-only'};
 const handlers=createSavedReportHandlers({inspectXlsx:async()=>structuredClone(fixture)});
 return {sql,env,handlers};
}
async function request(s,{method='POST',sub='owner',origin='https://office.invalid',marker='1',cost='42.00',payout='100.00',id='865265818'}={}){
 const headers={};if(sub)headers.Cookie=(await createSession(sub,'synthetic-secret')).split(';')[0];
 let body;if(method==='POST'){headers.Origin=origin;headers['X-WB-Save-Report']=marker;headers['X-WB-Import-Preview']='1';body=new FormData();body.set('reportId',id);body.set('expectedPayoutRub',payout);const bytes=new Uint8Array(220);bytes.set([80,75,3,4]);body.set('xlsx',new Blob([bytes]),'synthetic.xlsx');body.set('catalog',new Blob([JSON.stringify({reportId:id,items:[{vendorCode:'synthetic-vesta',unitCostRub:cost,status:'CONFIRMED_BY_USER'}]})]),'synthetic.json')}
 return s.handlers[method==='POST'?'onRequestPost':'onRequestGet']({request:new Request('https://office.invalid/api/wb/saved-report?reportId='+id,{method,headers,body}),env:s.env});
}
test('saves server-calculated real-source preview and reloads exact original restrictions',async()=>{
 const s=setup();const r=await request(s);assert.equal(r.status,201);const a=await r.json();assert.equal(a.snapshot.preview.estimate.cogsKop,4200);assert.equal(a.snapshot.preview.profitStatus,'UNVERIFIED');assert.equal(a.snapshot.preview.dataVerified,false);
 const b=await (await request(s,{method:'GET'})).json();assert.deepEqual(b.snapshot,a.snapshot);assert.equal(b.snapshot.source,'USER_SUPPLIED_WB_XLSX');assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM wb_saved_xlsx_reports').get().n,1);
});
test('identical replay idempotent; changed cost conflicts without overwrite',async()=>{
 const s=setup();await request(s);assert.equal((await request(s)).status,200);assert.equal((await request(s,{cost:'43.00'})).status,409);const r=await (await request(s,{method:'GET'})).json();assert.equal(r.snapshot.preview.estimate.cogsKop,4200);
});
test('concurrent duplicate attempts create exactly one report',async()=>{const s=setup();const rs=await Promise.all([request(s),request(s)]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,201]);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM wb_saved_xlsx_reports').get().n,1)});
test('failed reconciliation never writes',async()=>{const s=setup();assert.equal((await request(s,{payout:'99.00'})).status,422);assert.equal((await request(s,{cost:''})).status,422);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM wb_saved_xlsx_reports').get().n,0)});
test('anonymous and non-owner denied for reads and writes',async()=>{for(const method of ['GET','POST'])for(const [sub,status]of [[null,401],['staff',403]]){assert.equal((await request(setup(),{method,sub})).status,status)}});
test('CSRF, report allowlist and disabled mode fail closed',async()=>{
 assert.equal((await request(setup(),{origin:'https://evil.invalid'})).status,403);
 assert.equal((await request(setup(),{marker:'0'})).status,403);
 assert.equal((await request(setup(),{id:'123'})).status,400);
 const s=setup();delete s.env.WB_REPORT_SAVE_MODE;assert.equal((await request(s)).status,503);
});
test('rejects Ozon binding, missing binding and synthetic snapshot; isolates accounts',async()=>{
 const s=setup();s.env.WB_REPORT_SNAPSHOT_DB=s.env.OZON_FINANCE_DB;assert.equal((await request(s)).status,503);
 const missing=setup();delete missing.env.WB_REPORT_SNAPSHOT_DB;assert.equal((await request(missing)).status,503);
 const a=setup();await request(a);a.env.WB_REPORT_ACCOUNT_ID='other';assert.equal((await request(a,{method:'GET'})).status,404);
 const b=setup();await request(b);b.sql.exec("UPDATE wb_saved_xlsx_reports SET source='DEMO'");assert.equal((await request(b,{method:'GET'})).status,503);
});
test('database errors sanitized',async()=>{const s=setup();s.env.WB_REPORT_SNAPSHOT_DB={prepare(){throw Error('SECRET synthetic')}};const r=await request(s);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SECRET/);});

test('unconfirmed cost cannot be saved',async()=>{
 const s=setup();const custom=createSavedReportHandlers({inspectXlsx:async()=>structuredClone(fixture),calculate:()=>({dataVerified:false,profitStatus:'UNVERIFIED',estimate:{dataVerified:false,profitStatus:'UNVERIFIED'},reportId:'865265818',source:'XLSX_WITH_PRIVATE_SKU_CATALOG',wbPayoutReconciliation:'MATCHED_MANUAL_TARGET',breakdown:[{costStatus:'REFERENCE_UNVERIFIED'}]})});
 s.handlers=custom;assert.equal((await request(s)).status,422);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM wb_saved_xlsx_reports').get().n,0);
});
test('snapshot corruption and DEMO-like preview are rejected on read',async()=>{
 const s=setup();await request(s);s.sql.exec("UPDATE wb_saved_xlsx_reports SET snapshot_json='{}'");assert.equal((await request(s,{method:'GET'})).status,503);
});
test('response never returns owner ID, input hashes or private source files',async()=>{const s=setup();const body=await (await request(s)).json();assert.equal(body.snapshot.saved_by,undefined);assert.equal(body.fingerprint,undefined);assert.equal(body.snapshot.preview.persisted,false);assert.equal(body.persisted,true);assert.equal(body.storage,'TEST_D1')});
