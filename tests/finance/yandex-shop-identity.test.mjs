import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveYandexShop,yandexShopIdentityEvidence}
 from '../../web/office/yandex-shop-identity.mjs';
import {describeYandexReportSheets}
 from '../../web/office/yandex-report-archive.mjs';
test('Yandex same-OOO shops match numeric IDs, string IDs and exact names',()=>{
 assert.equal(resolveYandexShop({partnerId:149082506}),149082506);
 assert.equal(resolveYandexShop({partnerId:'149106500'}),149106500);
 assert.equal(resolveYandexShop({shopName:' автосклад '}),149106500);
 assert.equal(resolveYandexShop({shopName:'Студия Авто Дизайна (САД)'}),149082506);
 assert.equal(resolveYandexShop({businessId:123}),null);
 assert.equal(resolveYandexShop({campaignId:149082506,shopName:'автосклад'}),null);
 assert.equal(resolveYandexShop({partnerId:'123456789'}),null);
});
test('source Yandex finance groups confirmed shops and retains unmatched rows',()=>{
 const r=describeYandexReportSheets({'orders_and_offers_transactions.json':[
  {partnerId:'149082506',shopSku:'Vesta',billingPrice:8900},
  {shopName:'автосклад',shopSku:'EVA',billingPrice:2500},
  {partnerId:'0000001',shopSku:'unknown',billingPrice:1000}
 ]}).sheets[0];
 assert.equal(r.recognizedShopRows,2);
 assert.equal(r.shopIdentityEvidence.unmatchedRows,1);
 assert.deepEqual(r.shops.map(x=>[x.partnerId,x.rows]),
  [[149082506,1],[149106500,1]]);
 assert.equal(r.skuCandidates.length,2);
 assert.equal(r.skuCompleteness.includes('not verified'),true);
});

test('unknown partner IDs cannot be assigned to shop by shared business ID',()=>{
 const sharedBusiness=704400;
 assert.equal(resolveYandexShop({
  partnerId:sharedBusiness,businessId:sharedBusiness,
  shopName:'автосклад'
 }),null);
 assert.equal(resolveYandexShop({
  partnerId:String(sharedBusiness),businessId:sharedBusiness,
  shopName:'Студия Авто Дизайна (САД)'
 }),null);
 assert.equal(resolveYandexShop({
  partnerId:sharedBusiness,businessId:sharedBusiness+1,
  shopName:'автосклад'
 }),null);
 assert.equal(resolveYandexShop({
  partnerId:149082506,businessId:sharedBusiness,
  shopName:'автосклад'
 }),null);
 const evidence=yandexShopIdentityEvidence([{
  partnerId:sharedBusiness,businessId:sharedBusiness,
  shopName:'автосклад'
 }]);
 assert.equal(evidence.partnerIsBusiness,1);
 assert.equal(evidence.recognizedShopNames,1);
 assert.equal(evidence.verified,0);
});

test('October 2026 observed Yandex report store ID is independent of API campaign and business IDs',()=>{
 const yandex={partnerId:216779061,businessId:216779062,
  shopName:'Студия Авто Дизайна (САД)'};
 assert.equal(resolveYandexShop(yandex),149082506);
 assert.equal(resolveYandexShop({partnerId:'216779061',businessId:216779062,
  partnerName:'Студия Авто Дизайна (САД)'}),149082506);
 assert.equal(resolveYandexShop({partnerId:216779061,
  businessId:216779062}),149082506);
 assert.equal(resolveYandexShop({partnerId:216779061,
  shopName:'автосклад',businessId:216779062}),null);
 assert.equal(resolveYandexShop({partnerId:216779060,
  businessId:216779062,shopName:'автосклад'}),null);
 const sheet=describeYandexReportSheets({
  'orders_and_offers_transactions.json':[
   {...yandex,billingPrice:7000},
   {...yandex,billingPrice:5000}
  ]
 }).sheets[0];
 assert.equal(sheet.recognizedShopRows,2);
 assert.equal(sheet.shops[0].partnerId,149082506);
 assert.equal(sheet.shops[0].amounts.billingPrice,1200000);
});
