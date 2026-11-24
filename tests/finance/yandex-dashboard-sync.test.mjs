import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveYandexDashboardEvidence,loadYandexDashboardEvidence,
 rememberYandexDashboardEvidence,lastYandexDashboardEvidence}
 from '../../web/office/yandex-dashboard-evidence.mjs';
import {saveYandexReportJobs} from '../../web/office/yandex-finance-job-cache.mjs';
import {AUTOSKLAD63_LEGAL_ENTITY,EXCLUDED_THIRD_PARTY_YANDEX_CAMPAIGNS}
 from '../../web/office/legal-entity-scope.mjs';

const month='2026-10';
test('only IP Zhilina Olga is the AutoSklad63 financial owner',()=>{
 assert.equal(AUTOSKLAD63_LEGAL_ENTITY.displayName,'ИП Жилина Ольга');
 assert.deepEqual([...EXCLUDED_THIRD_PARTY_YANDEX_CAMPAIGNS],
  [149082506,149106500]);
});
test('old reported LLC numbers are excluded even with audited financial sources',()=>{
 const source={};
 for(const type of ['orders','services','payments'])
  source[type]={code:'yandex_report_archive_audited',
   readOnly:true,changedRecords:0,financeProfitVerified:false,
   sheets:[{sheet:'services_and_orders_margin.json',rows:79,
    sumFields:{incomeWithoutServices:{totalKopecks:61779235,
     rows:79,invalid:0}}}]};
 const result=deriveYandexDashboardEvidence(month,source);
 assert.equal(result.status,'unavailable');
 assert.equal(result.incomeKopecks,null);
 assert.equal(result.netProfitKopecks,null);
 assert.equal(result.reason,'third_party_llc_source_excluded');
 assert.equal(result.legalEntity,'ИП Жилина Ольга');
 assert.equal(rememberYandexDashboardEvidence({month,status:'order_income_verified',
  incomeKopecks:61779235,orders:79,netProfitKopecks:null}),false);
 assert.equal(lastYandexDashboardEvidence(month),null);
});
test('stale DONE report IDs cannot trigger API reads for an unrelated LLC',async()=>{
 const memory=new Map();
 const storage={getItem:k=>memory.get(k)||null,
  setItem:(k,v)=>memory.set(k,v)};
 const jobs=new Map(['orders','services','payments'].map(type=>
  [month+':all:'+type,{reportId:'third_party_'+type,status:'DONE',
   audited:true,createdAt:Date.now()-60000}]));
 assert.equal(saveYandexReportJobs(storage,jobs),true);
 let calls=0;
 const data=await loadYandexDashboardEvidence({month,storage,
  fetcher:async()=>{calls++;throw Error('Unexpected Yandex API call');}});
 assert.equal(calls,0);
 assert.equal(data.incomeKopecks,null);
 assert.equal(data.reason,'third_party_llc_source_excluded');
});
test('main dashboard retains IP-only label and omits third-party auto-load scripts',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const code=readFileSync(new URL('../../web/office/ceo-dashboard.mjs',import.meta.url),'utf8');
 const pnl=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 assert.match(html,/Яндекс Маркет · ИП Жилина Ольга/);
 assert.match(html,/Отчёты стороннего ООО исключены/);
 assert.doesNotMatch(html,/src="yandex-autopilot\.mjs/);
 assert.doesNotMatch(html,/src="yandex-finance-audit-ui\.mjs/);
 assert.doesNotMatch(html,/src="yandex-cost-crosswalk-ui\.mjs/);
 assert.match(code,/Отчёты стороннего ООО исключены/);
 assert.match(pnl,/Отчёты двух магазинов стороннего ООО исключены/);
 assert.doesNotMatch(html,/617\s*792,35\s*₽/);
});
