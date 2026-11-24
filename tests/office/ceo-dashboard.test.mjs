import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const html=file('web/office/index.html');
const js=file('web/office/ceo-dashboard.mjs');
const app=file('web/office/app.js');
const oauth=file('functions/api/auth/google/return.js');
test('executive dashboard is the first owner landing page with all core panels',()=>{
 assert.match(html,/href="#dashboard" data-page="dashboard"/);
 assert.match(html,/data-section="dashboard"/);
 for(const id of ['ceoBoard','ceoMonth','ceoRefresh','ceoOzonValue',
    'ceoProfitValue','ceoWbValue','ceoYandexValue','ceoProductionValue',
    'ceoAdsValue','ceoAdsRefresh','ceoOverallState'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/ceo-dashboard\.mjs/);
 assert.match(html,/ceo-dashboard\.css/);
 assert.match(app,/dashboard:'Пульт руководителя'/);
 assert.match(oauth,/'dashboard'/);
});
test('dashboard reads owner-only endpoints and never initiates writes',()=>{
 for(const path of ['/api/ozon/profit?month=','/api/wb/auto-sync-status',
  '/api/ms/production-auto-status','/api/ozon/ads-expense?month='])
    assert.ok(js.includes(path));
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/method:'GET'/);
 assert.doesNotMatch(js,/method:'POST'|localStorage|sessionStorage|innerHTML|eval\(/);
 assert.match(js,/reconciledToFinance!==false/);
 assert.match(js,/approvedForLiveQueue!==false/);
 assert.match(js,/close\.netProfitVerified!==false/);
 assert.match(js,/loadYandexDashboardEvidence/);
 assert.match(js,/showYandexDashboard/);
});
test('unknown business data is not presented as zero and advertising request is manual',()=>{
 assert.match(html,/Не подтверждена/);
 assert.match(html,/Общий подтверждённый чистый доход всех каналов пока неизвестен/);
 assert.match(js,/Не подтверждения|Нет подтверждения/);
 assert.match(js,/ceoAdsRefresh.*addEventListener\('click',refreshAds\)/);
 assert.doesNotMatch(js,/jsonGet\('\/api\/ozon\/ads-expense.*showAds/);
});
