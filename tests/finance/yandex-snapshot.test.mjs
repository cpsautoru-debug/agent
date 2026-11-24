import test from 'node:test';
import assert from 'node:assert/strict';
import {validateYandexEvidenceSnapshot,onRequestPost}
 from '../../functions/api/yandex/evidence-snapshot.js';
import {buildYandexSafeSkuEvidence}
 from '../../web/office/yandex-realization-cost-evidence.mjs';
import {describeYandexReportSheets}
 from '../../web/office/yandex-report-archive.mjs';
import {readFileSync} from 'node:fs';
const ids={
 orders:'id_order',services:'id_services',payments:'id_payments',
 realization149082506:'id_realization_1',
 realization149106500:'id_realization_2'
};
const base=()=>({month:'2026-10',reportIds:ids,evidence:{
 ownerEntity:'ИП Жилина Ольга',status:'partial',
 orderAfterServiceKopecks:61779235,deliveredCostKopecks:null,
 returnedValueKopecks:null,preliminaryContributionKopecks:null,
 orderRows:79,netProfitKopecks:null,issues:[],
 skus:[{partnerId:149082506,shopSku:'VESTA',
  name:'Чехлы Vesta',deliveredUnits:2,returnedUnits:1,
  costKopecks:420000,costStatus:'matched_exact'},
  {partnerId:149106500,shopSku:'OTHER',
   name:'Неизвестная комплектация',deliveredUnits:1,
   returnedUnits:0,costKopecks:null,costStatus:'missing'}]
}});
test('Yandex snapshot retains month, SKU/quantities, only IP owner and unknowns',()=>{
 const result=validateYandexEvidenceSnapshot(base());
 assert.equal(result.month,'2026-10');
 assert.equal(result.evidence.netProfitKopecks,null);
 assert.equal(result.evidence.skus[1].costKopecks,null);
 assert.equal(result.evidence.skus[0].returnedUnits,1);
 assert.equal(result.evidence.provenance,
  'owner_browser_audited_summary_not_bank_or_tax_closeout');
});
test('no fabricated net profit, unknown costs, foreign owner or false period',()=>{
 const invalid=[{e:{netProfitKopecks:1000}},
  {e:{status:'preliminary_contribution_ready',
   preliminaryContributionKopecks:1,
   deliveredCostKopecks:100,returnedValueKopecks:0}},
  {e:{ownerEntity:'ООО'}},
  {reportIds:{orders:'other'}},
  {month:'2026-11'},
  {e:{skus:[{...base().evidence.skus[0],
   shopSku:'VESTA',costKopecks:0}]}}
 ];
 for(const entry of invalid){
  const x=base();
  if(entry.e)Object.assign(x.evidence,entry.e);
  if(entry.month)x.month=entry.month;
  if(entry.reportIds)Object.assign(x.reportIds,entry.reportIds);
  assert.throws(()=>validateYandexEvidenceSnapshot(x));
 }
});
test('cross-site snapshot write is refused before owner auth',async()=>{
 const request=new Request('https://office.example/api/yandex/evidence-snapshot',{
  method:'POST',headers:{Origin:'https://attacker.invalid',
   'Content-Type':'application/json'},body:JSON.stringify(base())});
 const response=await onRequestPost({request,env:{}});
 assert.equal(response.status,403);
});
test('realized Yandex SKU ledger does not include orders or buyers',()=>{
 const report=files=>({code:'yandex_report_archive_audited',
  readOnly:true,changedRecords:0,
  sheets:describeYandexReportSheets(files).sheets});
 const source={
  149082506:report({'delivered.json':[
   {yourSku:'VESTA',offerName:'Vesta',deliveredCount:2,
    orderId:123,customerName:'hidden private'}],
   'returned.json':[{
    yourSku:'VESTA',offerName:'Vesta',returnedCount:1}]}),
  149106500:report({'delivered.json':[],'returned.json':[]})
 };
 const ledger=buildYandexSafeSkuEvidence({
  month:'2026-10',
  rows:[{partnerId:149082506,shopSku:'VESTA',
   name:'Чехлы Веста',costKopecks:420000,status:'matched_exact'}]
 },source);
 assert.equal(ledger.issues.length,0);
 assert.equal(ledger.rows.length,1);
 assert.equal(ledger.rows[0].deliveredUnits,2);
 assert.equal(ledger.rows[0].returnedUnits,1);
 assert.equal(ledger.rows[0].costKopecks,420000);
 assert.doesNotMatch(JSON.stringify(ledger),/customerName|orderId|private/);
});
test('finance page saves aggregates while net profit stays unverified',()=>{
 const js=readFileSync(new URL('../../web/office/yandex-cost-crosswalk-ui.mjs',import.meta.url),'utf8');
 assert.match(js,/api\/yandex\/evidence-snapshot/);
 assert.match(js,/buildYandexSafeSkuEvidence/);
 assert.match(js,/netProfitKopecks:null/);
});
