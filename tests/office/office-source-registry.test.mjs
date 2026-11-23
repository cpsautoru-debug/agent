import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OFFICE_SOURCES,createSourceRegistry} from '../../web/office/office-source-registry.mjs';
const contentOf=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('all roadmap modules have unique ID, phase, link and safe initial status',()=>{
 const ids=new Set;
 for(const s of OFFICE_SOURCES){
  assert.match(s.id,/^[a-z0-9]+$/);
  assert.ok(!ids.has(s.id)); ids.add(s.id);
  assert.ok([1,2,3].includes(s.phase));
  assert.match(s.section,/^[a-zA-Z]+$/);
  assert.ok(['planned','partial'].includes(s.status));
  assert.ok(s.next.length>10);
 }
 for(const needed of ['moysklad','inventory','ozon','wb','yandex','avito','agents','website','social','ozonads'])
   assert.ok(ids.has(needed),needed);
});
test('registry requires recognized sources and statuses and has immutable snapshots',()=>{
 const reg=createSourceRegistry();
 assert.equal(reg.update('unknown',{status:'verified'}),false);
 assert.equal(reg.update('ozon',{status:'done'}),false);
 assert.equal(reg.update('ozon',{status:'partial',detail:'Нужна сверка',checkedAt:12345}),true);
 const snap=reg.snapshot();assert.equal(snap.find(x=>x.id==='ozon').detail,'Нужна сверка');
 snap[0].status='verified';
 assert.equal(reg.snapshot()[0].status,OFFICE_SOURCES[0].status);
});
test('existing verified API panels report status into the common source registry',()=>{
 const js=contentOf('web/office/ceo-dashboard.mjs');
 const html=contentOf('web/office/index.html');
 assert.match(js,/from '\.\/office-source-registry\.mjs'/);
 assert.match(js,/reportSource\('moysklad','partial'/);
 assert.match(js,/reportSource\('wb','partial'/);
 assert.match(js,/reportSource\('ozon',verified\?'verified':'partial'/);
 assert.match(js,/reportSource\('ozonads','partial'/);
 assert.match(html,/id="ceoSourceRegistry"/);
 assert.match(html,/Карта подключения онлайн-офиса/);
 assert.doesNotMatch(js,/method:'POST'|localStorage|sessionStorage|innerHTML|eval\(/);
});
test('roadmap keeps production ahead of finances, agents and marketing',()=>{
 const docs=contentOf('docs/office-90-day-roadmap-and-dashboard-contract.md');
 for(const term of ['Этап 1','Этап 2','Этап 3','МойСклад','Wildberries','Яндекс Маркет','Авито','autosklad63.ru','ИИ-агенты','дашборда'])
  assert.ok(docs.includes(term),term);
 assert.match(docs,/Исторический сканер/);
 assert.match(docs,/Никакой записи из витрины/);
});
