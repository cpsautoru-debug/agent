import test from 'node:test';
import assert from 'node:assert/strict';
import {monthBounds,selectedBusiness,mapSafeYandexError}
 from '../../functions/api/yandex/finance-source.js';
import {onRequestGet,onRequestPost}
 from '../../functions/api/yandex/finance-reports.js';
import {onRequestGet as getArchive} from '../../functions/api/yandex/report-audit.js';
import {parseYandexZip,describeYandexReportSheets}
 from '../../web/office/yandex-report-archive.mjs';
import {readFileSync} from 'node:fs';
test('month bounds preserve inclusive October and reject invalid dates',()=>{
 assert.deepEqual(monthBounds('2026-10'),
  {dateFrom:'2026-10-01',dateTo:'2026-10-31'});
 assert.deepEqual(monthBounds('2026-02'),
  {dateFrom:'2026-02-01',dateTo:'2026-02-28'});
 assert.throws(()=>monthBounds('2026-13'));
});
test('Yandex financial data are confined to exactly one business by default',()=>{
 assert.deepEqual(selectedBusiness([
  {businessId:55,campaignId:22},{businessId:55,campaignId:11}
 ]),{businessId:55,campaignIds:[11,22]});
 assert.throws(()=>selectedBusiness([
  {businessId:55,campaignId:11},{businessId:56,campaignId:12}
 ]),/multiple_businesses/);
 assert.equal(mapSafeYandexError(new Error('secret-token-goes-here')),
   'yandex_source_unavailable');
});
test('Yandex report API requires session, scope and user-initiated posts',async()=>{
 let r=await onRequestGet({request:new Request(
  'https://office.example/api/yandex/finance-reports?action=discover'),env:{}});
 assert.equal(r.status,503);
 r=await onRequestPost({request:new Request(
  'https://office.example/api/yandex/finance-reports',{
   method:'POST',headers:{Origin:'https://evil.example',
    'Content-Type':'application/json'},
   body:JSON.stringify({month:'2026-10',reportType:'orders'})
  }),env:{}});
 assert.equal(r.status,403);
 r=await getArchive({request:new Request(
  'https://office.example/api/yandex/report-audit?reportId=foo&debug=1'),
  env:{}});
 assert.equal(r.status,400);
});
function makeStoredZip(name,content){
 const nameBytes=new TextEncoder().encode(name),
  source=new TextEncoder().encode(JSON.stringify(content));
 let crc=-1;
 for(const b of source){
  crc^=b;
  for(let i=0;i<8;i++)crc=(crc>>>1)^(-(crc&1)&0xedb88320);
 }
 crc=(crc^(-1))>>>0;
 const local=new Uint8Array(30+nameBytes.length+source.length);
 const view=new DataView(local.buffer);
 view.setUint32(0,0x04034b50,true);
 view.setUint16(4,20,true);
 view.setUint32(14,crc,true);
 view.setUint32(18,source.length,true);view.setUint32(22,source.length,true);
 view.setUint16(26,nameBytes.length,true);
 local.set(nameBytes,30);local.set(source,30+nameBytes.length);
 const central=new Uint8Array(46+nameBytes.length);
 const cv=new DataView(central.buffer);
 cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);
 cv.setUint16(6,20,true);cv.setUint32(16,crc,true);
 cv.setUint32(20,source.length,true);cv.setUint32(24,source.length,true);
 cv.setUint16(28,nameBytes.length,true);
 central.set(nameBytes,46);
 const end=new Uint8Array(22);
 const ev=new DataView(end.buffer);
 ev.setUint32(0,0x06054b50,true);ev.setUint16(8,1,true);
 ev.setUint16(10,1,true);ev.setUint32(12,central.length,true);
 ev.setUint32(16,local.length,true);
 const result=new Uint8Array(local.length+central.length+end.length);
 result.set(local);result.set(central,local.length);
 result.set(end,local.length+central.length);
 return result.buffer;
}
test('Yandex source ZIP is checked and raw transaction sums are not net profit',async()=>{
 const input=[{transactionSum:120.5,transactionType:'A'},
  {transactionSum:-20.25,transactionType:'B'}];
 const files=await parseYandexZip(makeStoredZip('transaction_date.json',input));
 const x=describeYandexReportSheets(files);
 assert.equal(x.sheets.length,1);
 assert.equal(x.sheets[0].rows,2);
 assert.deepEqual(x.sheets[0].transactionTypes,{A:12050,B:-2025});
 assert.equal(x.sheets[0].sumFields.transactionSum.totalKopecks,10025);
 assert.match(x.note,/NOT accounting revenue or net profit/);
 const tampered=new Uint8Array(makeStoredZip('transaction_date.json',input));
 tampered[30+'transaction_date.json'.length+5]^=0x01;
 await assert.rejects(parseYandexZip(tampered.buffer),/checksum|json_invalid/);
});
test('Yandex finance reporting is present in office UI without browser secret',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/yandex-finance-reports-ui.mjs',import.meta.url),'utf8');
 for(const id of ['yandexFinanceReports','yandexFinanceDiscover',
  'yandexFinanceGenerate','yandexFinanceCheckStatus','yandexFinanceAnalyze'])
  assert.match(html,new RegExp(id));
 assert.match(js,/\/api\/yandex\/finance-reports/);
 assert.match(js,/\/api\/yandex\/report-audit/);
 assert.doesNotMatch(js,/Api-Key|YANDEX_MARKET_API_KEY|localStorage/);
});
