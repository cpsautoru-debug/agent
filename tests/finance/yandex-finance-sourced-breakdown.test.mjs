import test from 'node:test';
import assert from 'node:assert/strict';
import {describeYandexReportSheets} from '../../web/office/yandex-report-archive.mjs';
import {collectYandexConfirmedJobs} from '../../web/office/yandex-finance-audit-ui.mjs';
import {saveYandexReportJobs} from '../../web/office/yandex-finance-job-cache.mjs';
test('Yandex services are grouped per service and partner, not added to orders/payments',()=>{
 const source={
  'marketplace_services.json':[
   {partnerId:149082506,serviceName:'Доставка',recordType:'CHARGE',servicePrice:100.12},
   {partnerId:149106500,serviceName:'Доставка',recordType:'CHARGE',servicePrice:50.35},
   {partnerId:149106500,serviceName:'Продвижение',recordType:'CHARGE',servicePrice:75.25}
  ]
 };
 const r=describeYandexReportSheets(source).sheets[0];
 assert.equal(r.rows,3);
 assert.equal(r.recognizedShopRows,3);
 assert.deepEqual(r.shops.map(x=>[x.partnerId,x.amounts.servicePrice]),
  [[149082506,10012],[149106500,12560]]);
 assert.equal(r.dimensions.serviceName.groups.length,2);
 assert.equal(r.dimensions.serviceName.groups[0].amounts.servicePrice,15047);
 assert.equal(r.dimensions.serviceName.groups[1].amounts.servicePrice,7525);
 assert.equal(r.sumFields.servicePrice.totalKopecks,22572);
});
test('unrecognized partner is not attributed to either ООО shop',()=>{
 const r=describeYandexReportSheets({'a.json':[
  {partnerId:149082506,servicePrice:10},
  {partnerId:999999,servicePrice:20}
 ]}).sheets[0];
 assert.equal(r.recognizedShopRows,1);
 assert.equal(r.rows,2);
 assert.equal(r.groupingStatus,'verified_campaign_or_shop_name');
});
test('full archive review requires all three audited DONE jobs from same period and scope',()=>{
 const map=new Map();
 const stamp=Date.now();
 for(const type of ['orders','services','payments']){
  map.set('2026-10:all:'+type,{reportId:'good_'+type,
   status:'DONE',createdAt:stamp,audited:true});
 }
 const storage={value:null,getItem(){return this.value;},
  setItem(key,v){this.value=v;}};
 saveYandexReportJobs(storage,map,stamp);
 assert.equal(Object.keys(collectYandexConfirmedJobs(storage,'2026-10','all')).length,3);
 assert.equal(Object.keys(collectYandexConfirmedJobs(storage,'2026-10','149082506')).length,0);
});

test('Yandex SKU evidence keeps shop names but never fabricates sales quantity',()=>{
 const r=describeYandexReportSheets({'orders_and_offers_transactions.json':[
  {partnerId:149082506,shopSku:'EVA-101',offerName:'Коврики EVA',
   offerStatus:'DELIVERED',count:2,billingPrice:2400},
  {partnerId:149082506,shopSku:'EVA-101',offerName:'Коврики EVA',
   offerStatus:'RETURNED',count:1,billingPrice:2400},
  {partnerId:149106500,shopSku:'COVER-202',offerName:'Авточехлы Vesta',
   offerStatus:'DELIVERED',billingPrice:7000}
 ]}).sheets[0];
 assert.equal(r.skuSourceCoverage,2);
 assert.equal(r.skuCandidates[0].reportRows,2);
 assert.deepEqual(r.skuCandidates[0].statuses,['DELIVERED','RETURNED']);
 assert.equal(r.skuCandidates[1].partnerId,149106500);
 assert.equal(r.skuCandidates[0].reportedQuantity,3);
 assert.equal(r.skuCandidates[0].quantityRows,2);
 assert.equal(r.skuCandidates[0].soldUnits,undefined);
 assert.match(r.skuCompleteness,/not verified/);
});

test('joint ООО Yandex source amounts remain available when store attribution is absent',()=>{
 const source=describeYandexReportSheets({'orders_and_offers_transactions.json':[
  {businessId:704400,partnerId:704400,shopName:'другой формат названия',
   billingPrice:12000},
  {businessId:704400,partnerId:704400,shopName:'другой формат названия',
   billingPrice:8000}
 ]}).sheets[0];
 assert.equal(source.rows,2);
 assert.equal(source.recognizedShopRows,0);
 assert.equal(source.sumFields.billingPrice.totalKopecks,2000000);
 assert.equal(source.skuSourceCoverage,0);
 assert.equal(source.shopIdentityEvidence.partnerIsBusiness,2);
});

test('Yandex invalid quantities stay unverified and never create sales',()=>{
 const r=describeYandexReportSheets({'orders_and_offers_transactions.json':[
  {partnerId:149082506,shopSku:'EVA',count:2,offerStatus:'DELIVERED'},
  {partnerId:149082506,shopSku:'EVA',count:-1,offerStatus:'RETURNED'},
  {partnerId:149082506,shopSku:'EVA',count:1.4,offerStatus:'PENDING'}
 ]}).sheets[0].skuCandidates[0];
 assert.equal(r.reportedQuantity,2);
 assert.equal(r.quantityRows,1);
 assert.equal(r.quantityInvalidRows,2);
 assert.equal(r.soldUnits,undefined);
});
