import test from 'node:test';
import assert from 'node:assert/strict';
import {describeYandexReportSheets}
 from '../../web/office/yandex-report-archive.mjs';
import {buildYandexMonthlyEvidence}
 from '../../web/office/yandex-month-evidence.mjs';
const audited=sheets=>({code:'yandex_report_archive_audited',sheets});
function sources(margin){
 return {
  orders:audited(describeYandexReportSheets({
   'services_and_orders_margin.json':margin
  }).sheets),
  services:audited(describeYandexReportSheets({
   'delivery.json':[
    {partnerId:216779061,servicePrice:100},
    {partnerId:216779061,servicePrice:50}
   ]
  }).sheets),
  payments:audited(describeYandexReportSheets({
   'transaction_date.json':[
    {partnerId:216779061,transactionSum:4500},
    {partnerId:216779061,transactionSum:-1000}
   ]
  }).sheets)
 };
}
test('Yandex October order income excludes in-report fees exactly once',()=>{
 const evidence=buildYandexMonthlyEvidence(sources([
  {orderId:100,shopName:'Студия Авто Дизайна (САД)',
   partnerId:216779061,businessId:216779062,
   incomeWithoutServices:5000,summaryCommission:1500,
   sumBillingPriceOfItems:6500},
  {orderId:101,shopName:'Студия Авто Дизайна (САД)',
   partnerId:216779061,businessId:216779062,
   incomeWithoutServices:3000,summaryCommission:500,
   sumBillingPriceOfItems:3500}
 ]));
 assert.equal(evidence.orderMargin.coverageConfirmed,true);
 assert.equal(evidence.preliminaryOrderAfterServiceKopecks,800000);
 assert.equal(evidence.orderMargin.commission.kopecks,200000);
 assert.equal(evidence.services.sheets[0].amount.kopecks,15000);
 assert.equal(evidence.payments.amount.kopecks,350000);
 assert.equal(evidence.financialResultKopecks,null);
 assert.equal(evidence.verifiedProfitKopecks,null);
});
test('duplicate order IDs and partially absent income never certify intermediate income',()=>{
 const duplicate=buildYandexMonthlyEvidence(sources([
  {orderId:100,incomeWithoutServices:1000},
  {orderId:100,incomeWithoutServices:1000}
 ]));
 assert.equal(duplicate.preliminaryOrderAfterServiceKopecks,null);
 assert.equal(duplicate.orderMargin.duplicates,1);
 const partial=buildYandexMonthlyEvidence(sources([
  {orderId:100,incomeWithoutServices:1000},
  {orderId:101}
 ]));
 assert.equal(partial.preliminaryOrderAfterServiceKopecks,null);
 assert.equal(partial.orderMargin.income.rows,1);
});
test('reports are mandatory and missing merchandise COGS blocks finished profitability',()=>{
 const absent=buildYandexMonthlyEvidence({});
 assert.equal(absent.status,'incomplete');
 assert.equal(absent.missing.length,3);
 const ready=buildYandexMonthlyEvidence(sources([
  {orderId:123,incomeWithoutServices:3000}
 ]));
 assert.equal(ready.status,'source_evidence_ready');
 assert.ok(ready.blocks.includes('sales_returns_and_sku_cogs_not_reconciled'));
 assert.equal(ready.verifiedProfitKopecks,null);
});
