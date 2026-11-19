// Worker-compatible, pure and read-only join for WB XLSX preflight and private SKU costs.
// Financial output is an UNVERIFIED management estimate; AUSN 8% is an assumption.
// Never embed the private catalog in public website assets.
import { buildWbProfitEstimate } from './wb-profit-estimate.mjs';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const ALLOWED_STATUS = new Set([
  'CONFIRMED_BY_USER', 'REFERENCE_UNVERIFIED', 'ASSUMED_UNCONFIRMED'
]);
const RUB = /^\d+(?:\.\d{1,2})?$/;
const REPORT = /^\d{1,20}$/;

function moneyToKop(value, label) {
  if (typeof value !== 'string' || !RUB.test(value)) {
    throw new Error(`invalid_rub_amount:${label}`);
  }
  const [whole, fraction = ''] = value.split('.');
  const kop = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (kop > MAX_SAFE) throw new Error(`amount_overflow:${label}`);
  return kop;
}

function asSafeNumber(value, label) {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new Error(`amount_overflow:${label}`);
  return Number(value);
}

function checkCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`invalid_count:${label}`);
  }
  return value;
}

function checkExactKeys(obj, keys, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      Object.keys(obj).some(key => !keys.includes(key))) {
    throw new Error(`unexpected_fields:${label}`);
  }
}

export function buildWbWorkerProfit1044({ preflight, catalog, reportId, expectedPayoutRub }) {
  if (typeof reportId !== 'string' || !REPORT.test(reportId)) throw new Error('invalid_report_id');
  if (!preflight || preflight.status !== 'XLSX_LOCAL_PREFLIGHT_UNVERIFIED' ||
      preflight.dataVerified !== false || !Array.isArray(preflight.counts)) {
    throw new Error('invalid_xlsx_preflight');
  }
  if (catalog?.reportId !== reportId || !Array.isArray(catalog.items)) {
    throw new Error('cost_catalog_report_mismatch');
  }
  checkExactKeys(catalog, ['reportId', 'items'], 'cost_catalog');
  const expected = moneyToKop(expectedPayoutRub, 'expected_payout');
  const payout = moneyToKop(preflight.payoutRub, 'xlsx_payout');
  if (payout !== expected) throw new Error('payout_does_not_match_manual_target');
  const taxBase = moneyToKop(preflight.assumedTaxBaseRub, 'tax_base');
  const taxPreview = moneyToKop(preflight.assumedAusn8Rub, 'preflight_tax');
  if (taxPreview !== (taxBase * 8n + 50n) / 100n) throw new Error('preflight_tax_mismatch');
  checkCount(preflight.sales, 'sales');
  checkCount(preflight.returns, 'returns');
  checkCount(preflight.skuCount, 'sku_count');
  if (preflight.sales === 0 || preflight.sourceRows < preflight.sales + preflight.returns ||
      preflight.skuCount !== preflight.counts.length ||
      preflight.skuCount !== catalog.items.length) {
    throw new Error('unexpected_report_shape');
  }

  const costs = new Map();
  for (const item of catalog.items) {
    checkExactKeys(item, ['vendorCode', 'unitCostRub', 'status'], 'cost_item');
    if (typeof item.vendorCode !== 'string' || !item.vendorCode.trim() ||
        item.vendorCode !== item.vendorCode.trim() || item.vendorCode.length > 200 ||
        !ALLOWED_STATUS.has(item.status) || costs.has(item.vendorCode)) {
      throw new Error('invalid_or_duplicate_cost_sku');
    }
    costs.set(item.vendorCode, {
      unitCostKop: moneyToKop(item.unitCostRub, 'unit_cost'),
      status: item.status
    });
  }

  let soldCount = 0;
  let returnCount = 0;
  let totalSold = 0n;
  let totalReturns = 0n;
  const statuses = Object.fromEntries([...ALLOWED_STATUS].map(status => [status, { units: 0, costKop: 0 }]));
  const breakdown = [];
  const seen = new Set();
  for (const line of preflight.counts) {
    if (!line || typeof line.sku !== 'string' || !line.sku || seen.has(line.sku)) {
      throw new Error('invalid_or_duplicate_xlsx_sku');
    }
    seen.add(line.sku);
    const saleQty = checkCount(line.sales, 'sku_sales');
    const returnQty = checkCount(line.returns, 'sku_returns');
    if (saleQty + returnQty === 0) throw new Error('empty_sku_counts');
    const cost = costs.get(line.sku);
    if (!cost) throw new Error('missing_cost_sku:' + line.sku);
    const lineSold = BigInt(saleQty) * cost.unitCostKop;
    const lineReturned = BigInt(returnQty) * cost.unitCostKop;
    totalSold += lineSold;
    totalReturns += lineReturned;
    soldCount += saleQty;
    returnCount += returnQty;
    statuses[cost.status].units += saleQty;
    statuses[cost.status].costKop = asSafeNumber(
      BigInt(statuses[cost.status].costKop) + lineSold, 'status_total');
    breakdown.push({
      sku: line.sku, sales: saleQty, returns: returnQty,
      unitCostKop: asSafeNumber(cost.unitCostKop, 'unit_cost'),
      soldCostKop: asSafeNumber(lineSold, 'sold_sku_cost'),
      returnCostKop: asSafeNumber(lineReturned, 'returned_sku_cost'),
      costStatus: cost.status
    });
  }
  if (soldCount !== preflight.sales || returnCount !== preflight.returns || seen.size !== costs.size) {
    throw new Error('sku_count_mismatch');
  }
  const estimate = buildWbProfitEstimate({
    reportId,
    payoutKop: asSafeNumber(payout, 'payout'),
    cogsKop: asSafeNumber(totalSold, 'cost_total'),
    taxBaseKop: asSafeNumber(taxBase, 'tax_base'),
    returnedCogsKop: asSafeNumber(totalReturns, 'return_cost_total')
  });
  if (estimate.taxKop !== asSafeNumber(taxPreview, 'tax_preview') ||
      estimate.dataVerified !== false || estimate.profitStatus !== 'UNVERIFIED') {
    throw new Error('estimate_contract_mismatch');
  }

  return Object.freeze({
    reportId, source: 'XLSX_WITH_PRIVATE_SKU_CATALOG',
    dataVerified: false, profitStatus: 'UNVERIFIED',
    wbPayoutReconciliation: 'MATCHED_MANUAL_TARGET',
    taxBasisStatus: 'ASSUMED_8_PERCENT_NOT_FNS_VERIFIED',
    returnValueStatus: 'REFERENCE_COST_NOT_ORIGINAL_SALE_VERIFIED',
    additionalExpensesStatus: 'NOT_RECONCILED',
    sales: soldCount, returns: returnCount, skuCount: seen.size,
    cogsQuality: statuses, breakdown,
    estimate
  });
}
