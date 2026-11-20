import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReportList } from '../../functions/api/wb/report-list.js';

test('WB report list: official fields, report types and matched payout', () => {
  const result = summarizeReportList([
    { reportId:865265818, dateFrom:'2026-10-01', dateTo:'2026-10-04',
      reportType:1, currency:'RUB', bankPaymentSum:'79226.33' },
    { reportId:865265821, dateFrom:'2026-10-01', dateTo:'2026-10-04',
      reportType:2, currency:'RUB', bankPaymentSum:'239.06' },
    { reportId:874345690, dateFrom:'2026-10-05', dateTo:'2026-10-11',
      reportType:2, currency:'RUB', bankPaymentSum:'0.00' }
  ]);
  assert.equal(result.reportCount,3);
  assert.equal(result.knownCount,3);
  assert.equal(result.reports[0].reportType,'Основной');
  assert.equal(result.reports[1].reportType,'По выкупам');
  assert.equal(result.reports[0].bankPaymentMatchesReference,true);
  assert.equal(result.reports[1].bankPaymentMatchesReference,true);
  assert.equal(result.reports[2].bankPaymentMatchesReference,null);
  assert.equal(result.d1Writes,0);
});

test('WB report list: mismatch does not claim verified reconciliation', () => {
  const result = summarizeReportList([
    { reportId:865265818, dateFrom:'2026-10-01', dateTo:'2026-10-04',
      reportType:1, currency:'RUB', bankPaymentSum:'79226.32' }
  ]);
  assert.equal(result.reports[0].bankPaymentMatchesReference,false);
  assert.equal(result.missing.length,9);
});

test('WB report list: reject duplicates and truncated pages', () => {
  const row = { reportId:865265818, dateFrom:'2026-10-01', dateTo:'2026-10-04',
    reportType:1, currency:'RUB', bankPaymentSum:'79226.33' };
  assert.throws(()=>summarizeReportList([row,row]),/invalid_report_list_item/);
  assert.throws(()=>summarizeReportList(Array(1000).fill(row)),/incomplete_report_list/);
});