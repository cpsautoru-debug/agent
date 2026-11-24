import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../../web/office/',import.meta.url);
const html=readFileSync(new URL('index.html',base),'utf8');
const text=path=>readFileSync(new URL(path,base),'utf8');
test('Yandex sidebar remains, with strict IP owner and third-party quarantine',()=>{
 assert.match(html,/href="#yandexFinance" data-page="yandexFinance"/);
 const start=html.indexOf('data-section="yandexFinance"');
 const next=html.indexOf('data-section="dashboard"');
 assert.ok(start>=0&&start<next);
 const finance=html.slice(start,next);
 assert.match(finance,/Яндекс Маркет · ИП Жилина Ольга/);
 assert.match(finance,/Отчёты стороннего ООО исключены/);
 for(const id of ['yandexFinanceReports','yandexConnectionCheck',
  'yandexFinanceDetailedResults'])
  assert.doesNotMatch(finance,new RegExp('id="'+id+'"'));
});
test('unverified third-party Yandex modules are not loaded into the IP dashboard',()=>{
 for(const file of ['yandex-connection-ui.mjs',
  'yandex-finance-reports-ui.mjs','yandex-finance-audit-ui.mjs',
  'yandex-autopilot.mjs','yandex-cost-crosswalk-ui.mjs']){
  const js=text(file);
  assert.ok(js.length>0);
  assert.doesNotMatch(html,new RegExp('src="'+file.replaceAll('.','\\.')+''));
 }
 assert.match(html,/id="businessPnl"/);
});
