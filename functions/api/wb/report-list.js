import { verifySession } from '../auth/session.js';

const ORIGIN = 'https://autosklad63-office-staging.pages.dev';
const API = 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list';
const LIMIT = 1000;
const KNOWN = {
  '865265818':'79226.33', '865265821':'239.06',
  '869950837':'48130.84', '876824501':'102347.21',
  '877508008':'19286.68', '883087726':'269138.50',
  '883087728':'27421.38', '890042785':'128246.46',
  '891644555':'11851.43'
};
const OCTOBER_REPORT_IDS = [...Object.keys(KNOWN), '874345690'];
const headers = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff',
  'Vary':'Cookie, Origin'
};
const json = (status, value) => new Response(JSON.stringify(value), { status, headers });

function cents(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -result : result;
}

export function summarizeReportList(rows) {
  if (!Array.isArray(rows) || rows.length >= LIMIT) throw Error('incomplete_report_list');
  const ids = new Set();
  const reports = rows.map(item => {
    const reportId = String(item?.reportId ?? '');
    if (!/^\d{1,20}$/.test(reportId) || ids.has(reportId)
        || !/^\d{4}-\d\d-\d\d$/.test(item?.dateFrom ?? '')
        || !/^\d{4}-\d\d-\d\d$/.test(item?.dateTo ?? '')
        || (item?.currency != null && item.currency !== 'RUB')) {
      throw Error('invalid_report_list_item');
    }
    ids.add(reportId);
    const bankPaymentRub = typeof item.bankPaymentSum === 'string' ? item.bankPaymentSum : null;
    const reference = KNOWN[reportId];
    return {
      reportId,
      dateFrom:item.dateFrom, dateTo:item.dateTo,
      reportType:item.reportType === 1 ? 'Основной' : item.reportType === 2 ? 'По выкупам' : 'Не определён',
      bankPaymentRub: bankPaymentRub != null && cents(bankPaymentRub) != null ? bankPaymentRub : null,
      bankPaymentMatchesReference: reference && cents(bankPaymentRub) != null
        ? cents(bankPaymentRub) === cents(reference) : null,
      knownOctoberReport: OCTOBER_REPORT_IDS.includes(reportId)
    };
  });
  return {
    code:'finance_report_list_received',
    reportCount:reports.length,
    knownCount:reports.filter(item=>item.knownOctoberReport).length,
    missing:OCTOBER_REPORT_IDS.filter(id=>!ids.has(id)),
    reports,
    comparisonBasis:'bankPaymentSum is compared with the manually confirmed payout; differences require investigation',
    d1Writes:0,
    cronEnabledByThisAction:false,
    retry:false
  };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('missing_body');
  const decoder = new TextDecoder('utf-8', { fatal:true });
  let text='', bytes=0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { text += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > 512*1024) throw Error('response_too_large');
      text += decoder.decode(value, { stream:true });
    }
  } finally { await reader.cancel().catch(()=>{}); }
  return JSON.parse(text);
}

export function createReportListHandler(fetcher=fetch) {
  return async function({request,env}) {
    try {
      if (!['GET','POST'].includes(request.method)) return json(405,{code:'method_not_allowed'});
      const url = new URL(request.url);
      if (url.origin!==ORIGIN || url.search) return json(403,{code:'scope_denied'});
      if (!env?.OFFICE_SESSION_SECRET || !env.OFFICE_ALLOWED_EMAIL || !env.OZON_FINANCE_DB ||
          env.WB_REPORT_ACCOUNT_ID!=='4271851' || env.WB_REPORT_SAVE_MODE!=='test-only')
        return json(503,{code:'configuration_unavailable'});
      const sub = await verifySession(request,env.OFFICE_SESSION_SECRET);
      if (!sub) return json(401,{code:'unauthorized'});
      const owner = await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if (owner?.allowed!==1) return json(403,{code:'forbidden'});
      if (typeof env.WB_API_TOKEN!=='string' || !env.WB_API_TOKEN || /\s/.test(env.WB_API_TOKEN))
        return json(503,{code:'finance_token_unavailable'});
      if (request.method==='GET') return json(200,{code:'owner_check_available'});
      if (request.headers.get('Origin')!==ORIGIN || request.headers.get('Content-Type')!=='application/json' ||
          request.headers.get('X-WB-Report-List')!=='october-2026')
        return json(403,{code:'invalid_request_origin'});
      if (Number(request.headers.get('Content-Length')||0)>16 || await request.text()!=='{}')
        return json(400,{code:'invalid_body'});
      let response;
      try {
        response = await fetcher(API,{
          method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
          headers:{Authorization:env.WB_API_TOKEN,'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify({dateFrom:'2026-10-01',dateTo:'2026-10-31',period:'weekly',limit:LIMIT,offset:0})
        });
      } catch(error) {
        return json(502,{code:error?.name==='TimeoutError'?'finance_timeout':'finance_transport_failure',upstreamHttp:null,retry:false});
      }
      if (response.status===204) return json(200,{code:'no_reports_returned',reportCount:0,missing:OCTOBER_REPORT_IDS,upstreamHttp:204,d1Writes:0,retry:false});
      if (response.status!==200) {
        await response.body?.cancel().catch(()=>{});
        return json(422,{code:({401:'finance_token_rejected',403:'finance_permission_denied',429:'finance_rate_limited'})[response.status]||'finance_upstream_failure',upstreamHttp:response.status,retry:false});
      }
      try {
        const result = summarizeReportList(await boundedJson(response));
        return json(200,{...result,upstreamHttp:200,upstreamRequests:1});
      } catch {
        return json(422,{code:'finance_list_not_reconciled',upstreamHttp:200,retry:false,d1Writes:0});
      }
    } catch {
      return json(503,{code:'finance_report_list_unavailable',retry:false});
    }
  };
}
export const onRequest=createReportListHandler();
