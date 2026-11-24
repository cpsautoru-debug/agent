import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../../web/office/',import.meta.url);
const html=readFileSync(new URL('index.html',base),'utf8');
const text=path=>readFileSync(new URL(path,base),'utf8');
test('Yandex finance is a separate navigable sidebar page, not embedded in dashboard',()=>{
 assert.match(html,/href="#yandexFinance" data-page="yandexFinance"/);
 const start=html.indexOf('data-section="yandexFinance"');
 const next=html.indexOf('data-section="dashboard"');
 assert.ok(start>=0&&start<next);
 const finance=html.slice(start,next);
 assert.match(finance,/id="yandexFinanceReports"/);
 assert.match(finance,/id="yandexConnectionCheck"/);
 assert.match(finance,/id="yandexFinanceDetailedResults"/);
 const dashboard=html.slice(next);
 assert.doesNotMatch(dashboard,/id="yandexFinanceReports"/);
 assert.doesNotMatch(dashboard,/id="yandexFinanceDetailedResults"/);
 assert.equal((html.match(/id="yandexFinanceReports"/g)||[]).length,1);
});
test('all Yandex finance modules initialize on dedicated page',()=>{
 for(const file of ['yandex-connection-ui.mjs',
  'yandex-finance-reports-ui.mjs','yandex-finance-audit-ui.mjs']){
  const src=text(file);
  assert.match(src,/#yandexFinance/);
  assert.doesNotMatch(src,/location\.hash\.split\('\/'\)\[0\]==='#dashboard'/);
 }
 assert.match(html,/id="businessPnl"/);
});
