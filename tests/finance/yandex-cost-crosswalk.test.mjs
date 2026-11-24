import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileYandexSharedCosts}
 from '../../web/office/yandex-cost-crosswalk-core.mjs';
import {collectOrderSkuCandidates}
 from '../../web/office/yandex-cost-crosswalk-ui.mjs';
import {onRequestPost}
 from '../../functions/api/yandex/catalog-cost-evidence.js';
import {readFileSync} from 'node:fs';

const audit=()=>({
 code:'unified_finance_source_audit',month:'2026-10',
 wb:{status:'ready',entries:[
  {vendorCode:'веста коричневая',validFrom:'2026-10-01',
   validTo:'2026-10-31',costKopecks:420000,status:'confirmed'},
  {vendorCode:'веста кросс с оранжевыми сотами',validFrom:'2026-10-01',
   validTo:'2026-10-31',costKopecks:450000,status:'confirmed'},
  {vendorCode:'чехлы приора сд, алька черные соты',validFrom:'2026-10-01',
   validTo:'2026-10-31',costKopecks:319900,status:'confirmed'},
  {vendorCode:'самара_белые_соты',validFrom:'2026-10-01',
   validTo:'2026-10-31',costKopecks:320000,status:'confirmed'},
  {vendorCode:'искра с белыми сотами',validFrom:'2026-10-01',
   validTo:'2026-10-31',costKopecks:469700,status:'confirmed'},
  {vendorCode:'карты_приора_черные_соты',validFrom:'2026-10-01',
   validTo:'2026-10-31',costKopecks:35000,status:'confirmed'},
  {vendorCode:'веста_чех_подлокот1',validFrom:'2026-10-01',
   validTo:'2026-10-31',costKopecks:10000,status:'confirmed'}
 ]},
 ozonCatalog:{entries:[
  {sku:'123',sellerArticle:'веста-коричневая',model:'Lada Vesta',
   costKopecks:420000,status:'confirmed'},
  {sku:'456',sellerArticle:'веста кросс-оранжевая поддержка-оранжевые соты',
   model:'Lada Vesta Cross',costKopecks:470000,status:'confirmed'}
 ]},
 ozonProfit:{entries:[]}
});
const item=(shopSku,name,partnerId=149082506)=>({partnerId,shopSku,name});
test('confirmed same-model costs can be reused but conflicting Cross remains unknown',()=>{
 const offers=[
  item('веста-коричневая','Авточехлы Lada Vesta'),
  item('PRIO-1','Авточехлы Lada Priora'),
  item('CROSS-1','Чехлы Lada Vesta Cross'),
  item('EVA-1','Коврики EVA Lada Vesta'),
  item('ARM-1','Чехол подлокотника Vesta'),
  item('DOOR-1','Дверные вставки Priora'),
  item('SKR-1','Чехлы Lada Iskra')];
 const r=reconcileYandexSharedCosts(offers,audit(),'2026-10');
 assert.equal(r.total,7);
 assert.equal(r.matched,5);
 assert.equal(r.rows[0].costKopecks,420000);
 assert.equal(r.rows[0].status,'matched_exact');
 assert.equal(r.rows[1].costKopecks,319900);
 assert.deepEqual(r.rows[2].pricesKopecks,[450000,470000]);
 assert.equal(r.rows[2].costKopecks,null);
 assert.equal(r.rows[3].status,'missing');
 assert.equal(r.rows[4].costKopecks,10000);
 assert.equal(r.rows[5].costKopecks,35000);
 assert.equal(r.rows[6].costKopecks,469700);
 assert.equal(r.netProfitKopecks,null);
});

test('main Ozon Profit cost ledger provides product cost via its verified article',()=>{
 const x=audit();
 x.ozonProfit={entries:[{sku:'5023073005',costKopecks:450000,
  validFrom:'2026-10-01',validTo:null,status:'confirmed'}]};
 x.ozonProfitCards={status:'ready',items:[{
  sku:'5023073005',sellerArticle:'чехлы-веста-кросс-оранжевые',
  name:'Авточехлы Lada Vesta Cross, оранжевые соты'
 }]};
 // Exactly the same physical article; explicit SKU mapping outranks
 // different variants' generic model costs.
 const r=reconcileYandexSharedCosts([
  item('чехлы-веста-кросс-оранжевые','Чехлы Vesta Cross')],
  x,'2026-10');
 assert.equal(r.rows[0].costKopecks,450000);
 assert.equal(r.rows[0].status,'matched_exact');
 assert.ok(r.rows[0].sources.includes('Ozon Profit'));
});
test('same Ozon SKU with conflicting auxiliary and main Profit costs is blocked',()=>{
 const x=audit();
 x.ozonCatalog.entries=[{sku:'5023073005',
  sellerArticle:'веста кросс-оранжевая поддержка-оранжевые соты',
  model:'Lada Vesta Cross',costKopecks:470000,status:'confirmed'}];
 x.ozonProfit={entries:[{sku:'5023073005',costKopecks:450000,
  validFrom:'2026-10-01',validTo:null,status:'confirmed'}]};
 x.ozonProfitCards={status:'ready',items:[{sku:'5023073005',
  sellerArticle:'веста кросс-оранжевая поддержка-оранжевые соты',
  name:'Модельные авточехлы на Lada Vesta Cross, черные с оранжевой поддержкой'
 }]};
 const r=reconcileYandexSharedCosts([
  item('5023073005','Модельные авточехлы на Lada Vesta Cross')],
  x,'2026-10');
 assert.equal(r.matched,0);
 assert.equal(r.conflicting.length,1);
 assert.deepEqual(r.conflicting[0].pricesKopecks,[470000,450000]);
});
test('preliminary and outside-period costs never count as confirmed',()=>{
 const x=audit();
 x.wb.entries=[{vendorCode:'коврики_ева',validFrom:'2026-11-01',
   validTo:null,costKopecks:300000,status:'confirmed'}];
 x.ozonCatalog.entries=[];
 const r=reconcileYandexSharedCosts([item('коврики_ева','Коврики EVA')],
  x,'2026-10');
 assert.equal(r.matched,0);
 assert.equal(r.rows[0].status,'missing');
});
test('missing and conflicting cost cannot be silently asserted for profit',()=>{
 const x=audit();
 x.wb.entries[0].status='preliminary';
 const r=reconcileYandexSharedCosts([item('вес-1','Чехлы Vesta Cross'),
  item('missing','Накидки универсальные')],x,'2026-10');
 assert.equal(r.matched,0);
 assert.equal(r.conflicting.length,1);
 assert.equal(r.missing.length,1);
 assert.equal(r.netProfitKopecks,null);
});
test('extracts only product transactions, not 79 order-level service rows',()=>{
 const source={code:'yandex_report_archive_audited',sheets:[
  {sheet:'orders_and_offers_transactions.json',
   skuCandidates:[{partnerId:149082506,shopSku:'SKU1',offerName:'Чехлы Vesta'},
    {partnerId:149082506,shopSku:'SKU1',offerName:''},
    {partnerId:149106500,shopSku:'SKU2',offerName:'Коврики EVA'}]},
  {sheet:'services_and_orders_margin.json',
   skuCandidates:[{partnerId:149082506,shopSku:'BAD'}]}
 ]};
 const r=collectOrderSkuCandidates(source);
 assert.equal(r.length,2);
 assert.equal(r[0].offerName,'Чехлы Vesta');
});
test('Yandex catalog evidence API is owner-only and rejects cross-site requests',async()=>{
 const request=new Request('https://office.example/api/yandex/catalog-cost-evidence',{
  method:'POST',headers:{Origin:'https://evil.example',
   'Content-Type':'application/json'},
  body:JSON.stringify({offerIds:['SKU1']})});
 const result=await onRequestPost({request,env:{}});
 assert.equal(result.status,403);
 const unauthenticated=await onRequestPost({request:new Request(
  'https://office.example/api/yandex/catalog-cost-evidence',{
   method:'POST',headers:{Origin:'https://office.example',
    'Content-Type':'application/json'},
   body:JSON.stringify({offerIds:['SKU1']})}),env:{}});
 assert.equal(unauthenticated.status,503);
});
test('cost-mapping UI is loaded by the office and source has no API keys',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const code=readFileSync(new URL('../../web/office/yandex-cost-crosswalk-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/yandex-cost-crosswalk-ui\.mjs/);
 assert.match(code,/\/api\/finance\/cost-audit/);
 assert.match(code,/\/api\/yandex\/catalog-cost-evidence/);
 assert.doesNotMatch(code,/YANDEX_MARKET_API_KEY|Api-Key/);
});
