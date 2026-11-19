import { verifySession } from '../auth/session.js';
import { inspectWbWorkerXlsx } from '../../../workers/wb-worker-preflight-1043.mjs';
import { buildWbWorkerProfit1044 } from '../../../workers/wb-worker-profit-1044.mjs';

// Owner-only read-only XLSX + private SKU catalog preview.
// All amounts and tax are UNVERIFIED estimates; no DB/API/storage writes.
const MAX_BODY = 3 * 1024 * 1024;
const MAX_XLSX = 2 * 1024 * 1024;
const MAX_CATALOG = 128 * 1024;
const FIELDS = ['catalog', 'expectedPayoutRub', 'reportId', 'xlsx'];
const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Vary': 'Cookie, Origin'
});

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function isFileLike(value) {
  return value && typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.arrayBuffer === 'function';
}

async function readLimitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty_body');
  const chunks = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('invalid_stream_chunk');
      count += value.byteLength;
      if (count > MAX_BODY) {
        await reader.cancel().catch(() => {});
        throw new Error('too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!count) throw new Error('empty_body');
  const buffer = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** Dependency injection is restricted to offline tests; Cloudflare calls onRequestPost. */
export function createImportPreviewHandler({
  inspectXlsx = inspectWbWorkerXlsx,
  calculate = buildWbWorkerProfit1044
} = {}) {
  return async function onImportPreviewPost({ request, env }) {
    if (!env?.OFFICE_SESSION_SECRET || !env.OFFICE_ALLOWED_EMAIL || !env.OZON_FINANCE_DB) {
      return json(503, { error: 'service_unavailable' });
    }
    try {
      const sub = await verifySession(request, env.OFFICE_SESSION_SECRET);
      if (!sub) return json(401, { error: 'unauthorized' });
      const owner = await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users " +
        "WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub, env.OFFICE_ALLOWED_EMAIL).first();
      if (owner?.allowed !== 1) return json(403, { error: 'forbidden' });
    } catch {
      return json(503, { error: 'service_unavailable' });
    }

    if (request.headers.get('Origin') !== new URL(request.url).origin ||
        request.headers.get('X-WB-Import-Preview') !== '1') {
      return json(403, { error: 'invalid_request_origin' });
    }
    const contentType = request.headers.get('Content-Type') || '';
    if (!/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) {
      return json(415, { error: 'multipart_required' });
    }
    const length = request.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
      return json(413, { error: 'request_too_large' });
    }

    let form;
    try {
      const body = await readLimitedBody(request);
      form = await new Request('https://local.invalid/import', {
        method: 'POST', headers: { 'Content-Type': contentType }, body
      }).formData();
    } catch (error) {
      return json(error?.message === 'too_large' ? 413 : 400,
        { error: error?.message === 'too_large' ? 'request_too_large' : 'invalid_multipart' });
    }
    if (JSON.stringify([...form.keys()].sort()) !== JSON.stringify(FIELDS)) {
      return json(400, { error: 'unexpected_form_fields' });
    }
    const xlsx = form.get('xlsx');
    const catalogFile = form.get('catalog');
    const reportId = form.get('reportId');
    const expectedPayoutRub = form.get('expectedPayoutRub');
    if (!isFileLike(xlsx) || !isFileLike(catalogFile) ||
        typeof reportId !== 'string' || !/^\d{1,20}$/.test(reportId) ||
        typeof expectedPayoutRub !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(expectedPayoutRub)) {
      return json(400, { error: 'invalid_form_input' });
    }
    if (xlsx.size < 200 || xlsx.size > MAX_XLSX ||
        catalogFile.size < 2 || catalogFile.size > MAX_CATALOG) {
      return json(413, { error: 'invalid_file_size' });
    }
    if (!/\.xlsx$/i.test(xlsx.name) || !/\.json$/i.test(catalogFile.name) ||
        !['', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(xlsx.type) ||
        !['', 'application/json', 'text/json', 'application/octet-stream'].includes(catalogFile.type)) {
      return json(415, { error: 'invalid_file_type' });
    }

    let bytes, catalog;
    try {
      bytes = new Uint8Array(await xlsx.arrayBuffer());
      // Reject obviously non-ZIP input before invoking XLSX parser.
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
        return json(422, { error: 'invalid_xlsx' });
      }
      catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true })
        .decode(await catalogFile.arrayBuffer()));
    } catch {
      return json(422, { error: 'invalid_document' });
    }
    try {
      const preflight = await inspectXlsx(bytes);
      if (!Number.isSafeInteger(preflight?.sourceRows) || preflight.sourceRows > 10_000 ||
          !Number.isSafeInteger(preflight?.skuCount) || preflight.skuCount > 1_000) {
        return json(422, { error: 'report_limits_exceeded' });
      }
      const result = calculate({ preflight, catalog, reportId, expectedPayoutRub });
      if (result?.dataVerified !== false || result?.profitStatus !== 'UNVERIFIED' ||
          result?.estimate?.dataVerified !== false || result?.estimate?.profitStatus !== 'UNVERIFIED') {
        return json(422, { error: 'unverified_contract_required' });
      }
      return json(200, {
        service: 'wb_finance', kind: 'xlsx_profit_preview',
        persisted: false, readOnly: true, reportAvailable: false,
        ...result
      });
    } catch {
      // Never echo SKU, internal error, source XLSX, or confidential catalog.
      return json(422, { error: 'xlsx_or_catalog_unreconciled' });
    }
  };
}

export const onRequestPost = createImportPreviewHandler();
