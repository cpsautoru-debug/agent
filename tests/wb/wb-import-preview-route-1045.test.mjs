import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const api = new URL('../../functions/api/', import.meta.url);
registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith(api.href) || !url.endsWith('.js')) return nextLoad(url, context);
    return { ...nextLoad(url, { ...context, format: 'module' }), format: 'module' };
  }
});
const { createImportPreviewHandler } = await import(new URL('wb/import-preview.js', api));
const { createSession } = await import(new URL('auth/session.js', api));

const secret = 'synthetic-only-no-real-keys';
const baseUrl = 'https://office.example.invalid/api/wb/import-preview';
const fixture = {
  status: 'XLSX_LOCAL_PREFLIGHT_UNVERIFIED', dataVerified: false,
  sourceRows: 8, sales: 3, returns: 1, skuCount: 2,
  payoutRub: '278.00', assumedTaxBaseRub: '300.00', assumedAusn8Rub: '24.00',
  counts: [{sku:'A',sales:2,returns:1},{sku:'B',sales:1,returns:0}]
};
const catalog = {reportId:'10293',items:[
  {vendorCode:'A',unitCostRub:'25.50',status:'CONFIRMED_BY_USER'},
  {vendorCode:'B',unitCostRub:'8.00',status:'ASSUMED_UNCONFIRMED'}
]};
let queries = 0, parses = 0;
const env = {
  OFFICE_SESSION_SECRET: secret, OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  OZON_FINANCE_DB: {
    prepare(sql) {
      queries += 1;
      assert.match(sql,/^SELECT 1 AS allowed FROM office_authorized_users/);
      return {bind(sub,email) {
        assert.equal(email,'owner@example.invalid');
        return {async first(){return sub==='owner' ? {allowed:1} : null;}};
      }};
    }
  }
};
const handler = createImportPreviewHandler({
  inspectXlsx: async bytes => {parses += 1;assert.equal(bytes[0],0x50); return structuredClone(fixture);}
});
function form({id='10293',payout='278.00',cat=catalog, xlsxType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',catalogType='application/json', xlsxBytes=null}={}) {
  const f = new FormData();
  const bytes = xlsxBytes || new Uint8Array(220);
  if (!xlsxBytes) bytes.set([0x50,0x4b,0x03,0x04],0);
  f.set('reportId',id);
  f.set('expectedPayoutRub',payout);
  f.set('xlsx',new Blob([bytes],{type:xlsxType}),'weekly.xlsx');
  f.set('catalog',new Blob([JSON.stringify(cat)],{type:catalogType}),'costs.json');
  return f;
}
async function send({sub='owner',origin=new URL(baseUrl).origin,marker='1',settings=env,body=form(),type=null}={}) {
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  if (marker !== null) headers['X-WB-Import-Preview'] = marker;
  if (sub) headers.Cookie = (await createSession(sub,secret)).split(';')[0];
  if (type !== null) headers['Content-Type'] = type;
  const request = new Request(baseUrl,{ method:'POST',headers,body });
  return handler({request,env:settings});
}

test('owner gets read-only clearly unverified preview from multipart',async()=>{
  const r=await send();assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);
  const v=await r.json();assert.equal(v.kind,'xlsx_profit_preview');
  assert.equal(v.persisted,false);assert.equal(v.readOnly,true);
  assert.equal(v.profitStatus,'UNVERIFIED');assert.equal(v.dataVerified,false);
  assert.equal(v.estimate.profitWithoutRestorationKop,19500);
  assert.equal(v.estimate.profitWithRestorationKop,22050);
  assert.equal(v.estimate.taxKop,2400);
  assert.equal(v.cogsQuality.ASSUMED_UNCONFIRMED.units,1);
});
test('anonymous 401 before D1 access or XLSX parsing',async()=>{
  const q=queries,p=parses;assert.equal((await send({sub:null})).status,401);
  assert.equal(queries,q);assert.equal(parses,p);
});
test('non-owner receives 403 without parsing',async()=>{
  const p=parses;assert.equal((await send({sub:'staff'})).status,403);assert.equal(parses,p);
});
test('missing security configuration fails closed',async()=>{
  assert.equal((await send({settings:{...env,OFFICE_ALLOWED_EMAIL:''}})).status,503);
});
test('wrong or missing origin denied',async()=>{
  assert.equal((await send({origin:'https://evil.example.invalid'})).status,403);
  assert.equal((await send({origin:null})).status,403);
});
test('anti-CSRF header required',async()=>{
  assert.equal((await send({marker:null})).status,403);
  assert.equal((await send({marker:'0'})).status,403);
});
test('requires multipart content-type',async()=>{
  assert.equal((await send({body:'hello',type:'text/plain'})).status,415);
});
test('rejects oversized streaming request',async()=>{
  const big=new Uint8Array(3*1024*1024+1);
  const r=await send({body:big,type:'multipart/form-data; boundary=abc'});
  assert.equal(r.status,413);
});
test('unexpected extra field rejected',async()=>{
  const f=form();f.set('advertisingRub','27189');assert.equal((await send({body:f})).status,400);
});
test('rejects missing file',async()=>{
  const f=form();f.delete('xlsx');assert.equal((await send({body:f})).status,400);
});
test('rejects incorrect XLSX type and non-ZIP XLSX content',async()=>{
  assert.equal((await send({body:form({xlsxType:'text/plain'})})).status,415);
  assert.equal((await send({body:form({xlsxBytes:new Uint8Array(220)})})).status,422);
});
test('rejects catalog that does not match report',async()=>{
  assert.equal((await send({body:form({cat:{...catalog,reportId:'7'}})})).status,422);
});
test('rejects expected payout mismatch',async()=>{
  assert.equal((await send({body:form({payout:'277.99'})})).status,422);
});
test('rejects bad report number',async()=>{
  assert.equal((await send({body:form({id:'../../123'})})).status,400);
});
test('report size limit prevents huge report',async()=>{
  const big=structuredClone(fixture);big.sourceRows=10001;
  const limited=createImportPreviewHandler({inspectXlsx:async()=>big});
  const cookie=(await createSession('owner',secret)).split(';')[0];
  const r=await limited({request:new Request(baseUrl,{method:'POST',headers:{Origin:new URL(baseUrl).origin,'X-WB-Import-Preview':'1',Cookie:cookie},body:form()}),env});
  assert.equal(r.status,422);
});
test('failure of XLSX parser is returned as non-leaking error',async()=>{
  const faulty=createImportPreviewHandler({inspectXlsx:async()=>{throw new Error('PRIVATE SELLER FILE CONTENT!');}});
  const cookie=(await createSession('owner',secret)).split(';')[0];
  const r=await faulty({request:new Request(baseUrl,{method:'POST',headers:{Origin:new URL(baseUrl).origin,'X-WB-Import-Preview':'1',Cookie:cookie},body:form()}),env});
  assert.equal(r.status,422);
  assert.doesNotMatch(await r.text(),/PRIVATE SELLER FILE CONTENT/);
});
