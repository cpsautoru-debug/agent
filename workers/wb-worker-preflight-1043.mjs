// Read-only, Cloudflare-Workers-compatible XLSX preflight for WB.
// No Node builtins, no HTTP, no database, no permanent persistence.
// Not a verified tax or profit report. Do not expose as a public endpoint.

const HEADERS = Object.freeze({
  operation: 'Обоснование для оплаты',
  sku: 'Артикул поставщика',
  quantity: 'Кол-во',
  sellerPrice: 'Цена розничная с учетом согласованной скидки',
  retail: 'Вайлдберриз реализовал Товар (Пр)',
  forPay: 'К перечислению Продавцу за реализованный Товар',
  delivery: 'Услуги по доставке товара покупателю',
  storage: 'Хранение',
  deduction: 'Удержания',
  penalty: 'Общая сумма штрафов'
});
const MAIN_XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const AMOUNT = /^-?\d+(?:\.\d{1,2})?$/;

function requirePart(entries, name) {
  const value = entries.get(name);
  if (!(value instanceof Uint8Array)) throw new Error('missing_xlsx_part:' + name);
  return new TextDecoder().decode(value);
}

function moneyKop(value, label, { optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return 0n;
    throw new Error('missing_amount:' + label);
  }
  const text = String(value).trim();
  if (!AMOUNT.test(text)) throw new Error('invalid_amount:' + label);
  const neg = text.startsWith('-');
  const [whole, decimal = ''] = (neg ? text.slice(1) : text).split('.');
  const result = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  return neg ? -result : result;
}

function asRub(kop) {
  const absolute = kop < 0n ? -kop : kop;
  return `${kop < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function requireQtyOne(raw, rowNumber) {
  if (!/^[+]?(?:1|1\.0+)$/.test(String(raw || '').trim())) {
    throw new Error('unsupported_qty_row:' + rowNumber);
  }
}

// Convert inlineStr cells to string-table indices, WITHOUT changing the XLSX bytes.
// The XML fragment is used only to feed the EXISTING, vetted shared-strings reader.
// This intentionally rejects unrecognized inline cell contents, rather than losing text.
export function normalizeInlineCells(sheetXml, startingIndex = 0) {
  if (typeof sheetXml !== 'string' || !Number.isSafeInteger(startingIndex) || startingIndex < 0) {
    throw new Error('invalid_normalization_input');
  }
  let converted = 0;
  const stringFragments = [];
  const normalizedXml = sheetXml.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (whole, attrs, inner) => {
    if (!/\bt=(['"])inlineStr\1/.test(attrs)) return whole;
    const match = /^\s*<is\b[^>]*>([\s\S]*?)<\/is>\s*$/.exec(inner);
    if (!match) throw new Error('unsupported_inline_cell');
    const value = match[1];
    if (!/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/.test(value)) {
      throw new Error('inline_string_without_text');
    }
    const index = startingIndex + converted;
    converted += 1;
    stringFragments.push(`<si>${value}</si>`);
    const nextAttrs = attrs.replace(/\bt=(['"])inlineStr\1/, 't="s"');
    return `<c${nextAttrs}><v>${index}</v></c>`;
  });
  if (normalizedXml.includes('t="inlineStr"') || normalizedXml.includes("t='inlineStr'")) {
    throw new Error('unconverted_inline_cell');
  }
  return { normalizedXml, converted, stringFragments };
}

function worksheetPaths(workbookXml, relationshipsXml) {
  const relations = new Map();
  for (const tag of relationshipsXml.match(/<Relationship\b[^>]*>/g) || []) {
    const id = tag.match(/\bId="([^"]+)"/)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
    const path = target?.startsWith('/') ? target.slice(1) : `xl/${target}`;
    if (id && /^xl\/worksheets\/[\w.-]+\.xml$/.test(path)) relations.set(id, path);
  }
  const paths = [];
  for (const tag of workbookXml.match(/<sheet\b[^>]*>/g) || []) {
    const id = tag.match(/\br:id="([^"]+)"/)?.[1];
    if (relations.has(id)) paths.push(relations.get(id));
  }
  return paths;
}

export function summarizeWbDetailRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('wb_detail_rows_missing');
  const [header, ...details] = rows;
  const indexes = new Map();
  header.cells.forEach((cell, index) => {
    const label = cell?.value?.trim();
    if (!label || !Object.values(HEADERS).includes(label)) return;
    if (indexes.has(label)) throw new Error('wb_duplicate_header:' + label);
    indexes.set(label, index);
  });
  for (const h of Object.values(HEADERS)) {
    if (!indexes.has(h)) throw new Error('wb_missing_header:' + h);
  }
  const get = (cells, field) => cells[indexes.get(HEADERS[field])]?.value?.trim() ?? null;
  let sales = 0;
  let returns = 0;
  let saleSeller = 0n;
  let refundSeller = 0n;
  let saleForPay = 0n;
  let refundForPay = 0n;
  const charges = { delivery: 0n, storage: 0n, deduction: 0n, penalty: 0n };
  const counts = new Map();
  let sourceRows = 0;

  for (const { rowNumber, cells } of details) {
    if (!cells.some(c => c?.value?.trim())) continue;
    sourceRows += 1;
    const operation = get(cells, 'operation');
    if (!operation) throw new Error('wb_missing_operation_row:' + rowNumber);
    for (const field of Object.keys(charges)) {
      charges[field] += moneyKop(get(cells, field), `${field}_${rowNumber}`, { optional: true });
    }
    if (operation !== 'Продажа' && operation !== 'Возврат') continue;
    requireQtyOne(get(cells, 'quantity'), rowNumber);
    const sku = get(cells, 'sku');
    if (!sku) throw new Error('wb_missing_sku_row:' + rowNumber);
    const price = moneyKop(get(cells, 'sellerPrice'), `seller_price_${rowNumber}`);
    const payout = moneyKop(get(cells, 'forPay'), `for_pay_${rowNumber}`);
    if (price < 0n || payout < 0n) throw new Error('negative_sale_return_amount');
    const count = counts.get(sku) || { sales: 0, returns: 0 };
    if (operation === 'Продажа') {
      sales += 1;
      saleSeller += price;
      saleForPay += payout;
      count.sales += 1;
    } else {
      returns += 1;
      refundSeller += price;
      refundForPay += payout;
      count.returns += 1;
    }
    counts.set(sku, count);
  }
  if (!sales) throw new Error('no_wb_sales');
  const taxBase = saleSeller - refundSeller;
  if (taxBase < 0n) throw new Error('negative_tax_base');
  const payout = saleForPay - refundForPay - charges.delivery - charges.storage - charges.deduction - charges.penalty;
  const tax = (taxBase * 8n + 50n) / 100n;
  return Object.freeze({
    status: 'XLSX_LOCAL_PREFLIGHT_UNVERIFIED',
    dataVerified: false,
    sourceRows, sales, returns, skuCount: counts.size,
    salesSellerRub: asRub(saleSeller),
    returnsSellerRub: asRub(refundSeller),
    assumedTaxBaseRub: asRub(taxBase),
    assumedAusn8Rub: asRub(tax),
    payoutRub: asRub(payout),
    saleForPayRub: asRub(saleForPay),
    refundForPayRub: asRub(refundForPay),
    chargesRub: Object.fromEntries(Object.entries(charges).map(([key, val]) => [key, asRub(val)])),
    counts: [...counts].map(([sku, count]) => ({ sku, ...count }))
  });
}

export async function inspectWbWorkerXlsx(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 200 || bytes.length > 2 * 1024 * 1024) {
    throw new Error('xlsx_invalid_or_exceeds_preflight_limit');
  }
  const { readZipEntries, parseSharedStrings, parseSheetRows } =
    await import('../functions/api/ozon/xlsx-parser.js');
  const entries = await readZipEntries(bytes);
  if (!(entries instanceof Map) || entries.size > 300) throw new Error('xlsx_too_many_parts');
  const total = [...entries.values()].reduce((sum, value) => sum + value.byteLength, 0);
  if (total > 30 * 1024 * 1024) throw new Error('xlsx_parts_exceed_preflight_limit');
  const text = new TextDecoder();
  const initialStrings = entries.has('xl/sharedStrings.xml')
    ? parseSharedStrings(text.decode(entries.get('xl/sharedStrings.xml')))
    : [];
  if (!Array.isArray(initialStrings)) throw new Error('unexpected_shared_strings_format');
  const paths = worksheetPaths(
    requirePart(entries, 'xl/workbook.xml'),
    requirePart(entries, 'xl/_rels/workbook.xml.rels')
  );
  if (paths.length < 1 || paths.length > 50) throw new Error('unexpected_sheet_count');
  const candidates = [];
  let convertedInline = 0;
  for (const path of paths) {
    const sheetXml = requirePart(entries, path);
    const normalized = normalizeInlineCells(sheetXml, initialStrings.length);
    const appended = normalized.stringFragments.length
      ? parseSharedStrings(`<sst xmlns="${MAIN_XML_NS}">${normalized.stringFragments.join('')}</sst>`)
      : [];
    if (!Array.isArray(appended) || appended.length !== normalized.converted) {
      throw new Error('inline_string_count_mismatch');
    }
    const rows = parseSheetRows(normalized.normalizedXml, initialStrings.concat(appended));
    if (rows[0]?.cells.some(c => c?.value?.trim() === HEADERS.operation)) {
      candidates.push(rows);
      convertedInline = normalized.converted;
    }
  }
  if (candidates.length !== 1) throw new Error('wb_detail_sheet_ambiguous_or_missing');
  return Object.freeze({ ...summarizeWbDetailRows(candidates[0]), convertedInline });
}
