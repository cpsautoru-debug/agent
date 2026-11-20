import { verifySession } from '../auth/session.js';

const ORIGIN = 'https://autosklad63-office-staging.pages.dev';
const EXPECTED = ['865265818','865265821','869950837','874345690','876824501','877508008','883087726','883087728','890042785','891644555'];
const API = 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list';
const EXPECTED_PAYMENTS = {
  '865265818':'79226.33', '865265821':'239.06',
  '869950837':'48130.84', '876824501':'102347.21',
  '877508008':'19286.68', '883087726':'269138.50',
  '883087728':'27421.38', '890042785':'128246.46',
  '891644555':'11851.43'
};
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Vary': 'Cookie, Origin'
};
const json = (status, value) => new Response(JSON.stringify(value), { status, headers });

async function readBounded(response, maxBytes = 512 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('missing_body');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { text += decoder.decode(); break; }
      length += value.byteLength;
      if (length > maxBytes) throw Error('response_too_large');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
  return text;
}

export function createReportListHandler(fetcher = fetch) {
  return async ({ request, env }) => {
    try {
      if (request.method !== 'POST') return json(405, { code: 'method_not_allowed' });
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || url.search || request.headers.get('Origin') !== ORIGIN ||
          request.headers.get('X-WB-Report-List') !== 'october-2026' ||
          request.headers.get('Content-Type') !== 'application/json') {
        return json(403, { code: 'invalid_request_origin' });
      }
      if (!env?.OFFICE_SESSION_SECRET || !env.OFFICE_ALLOWED_EMAIL || !env.OZON_FINANCE_DB ||
          env.WB_REPORT_ACCOUNT_ID !== '4271851' || env.WB_REPORT_SAVE_MODE !== 'test-only') {
        return json(503, { code: 'configuration_unavailable' });
      }
      const sub = await verifySession(request, env.OFFICE_SESSION_SECRET);
      if (!sub) return json(401, { code: 'unauthorized' });
      const owner = await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub, env.OFFICE_ALLOWED_EMAIL).first();
      if (owner?.allowed !== 1) return json(403, { code: 'forbidden' });
      if (typeof env.WB_API_TOKEN !== 'string' || !env.WB_API_TOKEN || /\s/.test(env.WB_API_TOKEN)) {
        return json(503, { code: 'finance_token_unavailable' });
      }
      if (Number(request.headers.get('Content-Length') || 0) > 16) return json(400, { code: 'invalid_body' });
      if (await request.text() !== '{}') return json(400, { code: 'invalid_body' });

      let response;
      try {
        response = await fetcher(API, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: env.WB_API_TOKEN,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            dateFrom: '2026-10-01',
            dateTo: '2026-10-31',
            period: 'weekly',
            limit: 1000,
            offset: 0
          })
        });
      } catch (error) {
        return json(502, {
          code: error?.name === 'TimeoutError' ? 'finance_timeout' : 'finance_transport_failure',
          upstreamHttp: null, retry: false
        });
      }
      if (response.status === 204) return json(200, {
        code: 'no_reports_returned', reportCount: 0, missing: EXPECTED,
        upstreamHttp: 204, d1Writes: 0, retry: false
      });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return json(422, {
          code: response.status === 401 ? 'finance_token_rejected' :
                response.status === 403 ? 'finance_permission_denied' :
                response.status === 429 ? 'finance_rate_limited' : 'finance_upstream_failure',
          upstreamHttp: response.status, retry: false
        });
      }

      let raw;
      try { raw = JSON.parse(await readBounded(response)); }
      catch { return json(422, { code: 'invalid_finance_list_response', upstreamHttp: 200 }); }
      if (!Array.isArray(raw) || raw.length >= 1000) {
        return json(422, { code: 'incomplete_finance_list', upstreamHttp: 200, retry: false });
      }
      const seen = new Set();
      const reports = [];
      for (const item of raw) {
        const reportId = String(item?.reportId ?? '');
        if (!/^\d{1,20}$/.test(reportId) || seen.has(reportId) ||
            !/^\d{4}-\d\d-\d\d$/.test(item?.dateFrom ?? '') ||
            !/^\d{4}-\d\d-\d\d$/.test(item?.dateTo ?? '')) {
          return json(422, { code: 'invalid_finance_list_items', upstreamHttp: 200 });
        }
        seen.add(reportId);
        const type = item.reportType;
        const bankPayment = typeof item.bankPaymentSum === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(item.bankPaymentSum)
          ? item.bankPaymentSum : null;
        const expected = EXPECTED_PAYMENTS[reportId];
        reports.push({
          reportId,
          dateFrom: item.dateFrom,
          dateTo: item.dateTo,
          reportType: type === 1 || type === 2 ? type : null,
          bankPaymentRub: bankPayment,
          payoutMatchesReference: expected && bankPayment !== null
            ? (BigInt(bankPayment.replace('.', '') + '') === BigInt(expected.replace('.', '')) ? true : Number(bankPayment) === Number(expected))
            : null,
          knownOctoberReport: EXPECTED.includes(reportId)
        });
      }
      return json(200, {
        code: 'finance_report_list_received', upstreamHttp: 200,
        reportCount: reports.length, knownCount: reports.filter(x => x.knownOctoberReport).length,
        missing: EXPECTED.filter(id => !seen.has(id)),
        reports, d1Writes: 0, cronEnabledByThisAction: false, retry: false
      });
    } catch {
      return json(503, { code: 'finance_report_list_unavailable', retry: false });
    }
  };
}

export const onRequest = createReportListHandler();
