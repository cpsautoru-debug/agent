import {verifySession} from '../auth/session.js';

const HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'private, no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'vary':'Cookie, Origin'
};
const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const WORKER_ORIGIN='https://autosklad63-ozon-ads-staging.cpsautoru.workers.dev';
const OWNER_SQL="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const validMonth=m=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(m||'');
function closedMonth(m,now=Date.now()){
  if(!validMonth(m))return false;
  const [year,mon]=m.split('-').map(Number);
  return Date.UTC(year,mon,0)<now;
}
export function createOzonAdsExpenseHandler({fetcher=fetch,now=Date.now}={}){
  return async function onRequestGet({request,env}){
    if(request.method!=='GET')return respond(405,{code:'method_not_allowed'});
    const url=new URL(request.url);
    if(url.pathname!=='/api/ozon/ads-expense'||url.hash||
      url.searchParams.size!==1||!url.searchParams.has('month')||
      !closedMonth(url.searchParams.get('month'),now()))
      return respond(400,{code:'invalid_closed_month'});
    if(!env?.OFFICE_SESSION_SECRET||!env?.OFFICE_ALLOWED_EMAIL||
      !env?.OZON_FINANCE_DB)
      return respond(503,{code:'office_configuration_unavailable'});
    let sub;
    try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return respond(401,{code:'unauthorized'});}
    if(!sub)return respond(401,{code:'unauthorized'});
    try{
      const owner=await env.OZON_FINANCE_DB.prepare(OWNER_SQL)
        .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return respond(403,{code:'forbidden'});
    }catch{return respond(503,{code:'owner_check_unavailable'});}
    // No caller-supplied URL: prevents SSRF and exposure of the shared token.
    if(typeof env.ADS_READ_TOKEN!=='string'||env.ADS_READ_TOKEN.length<32)
      return respond(503,{code:'ads_bridge_secret_missing'});
    try{
      const upstream=new URL('/api/internal/expense',WORKER_ORIGIN);
      upstream.searchParams.set('month',url.searchParams.get('month'));
      const result=await fetcher(upstream.toString(),{
        method:'GET',redirect:'error',
        headers:{authorization:'Bearer '+env.ADS_READ_TOKEN,accept:'application/json'},
        signal:AbortSignal.timeout(17000)
      });
      // Upstream status is mapped to fixed codes; raw body never forwarded
      // when source errors (could contain external provider details).
      if(!result.ok)return respond(503,{code:result.status===401?
        'ads_bridge_token_rejected':
        result.status===422?'ozon_expense_schema_unverified':
        'ozon_ads_source_unavailable'});
      if(!(result.headers.get('content-type')||'').includes('application/json'))
        return respond(503,{code:'ozon_ads_response_unrecognized'});
      const data=await result.json();
      if(data?.code!=='ozon_expense_source_preview'||
        data.source!=='OZON_PERFORMANCE_API'||data.month!==url.searchParams.get('month')||
        data.readOnly!==true||data.changedRecords!==0||
        data.monetaryTotalsVerified!==false||data.reconciledToFinance!==false||
        data.totalExpenseKopecks!==null||!Number.isSafeInteger(data.recordCount)||
        data.recordCount<0||data.recordCount>10000||!Array.isArray(data.fieldNames)||
        data.fieldNames.length>30||data.fieldNames.some(x=>typeof x!=='string'||
        !/^[a-zA-Z_][a-zA-Z0-9_]{0,80}$/.test(x)))
        return respond(503,{code:'ozon_ads_evidence_unrecognized'});
      // Only allowlisted, non-monetary diagnostic fields reach the UI.
      return respond(200,{
        code:'ozon_ads_office_preview',month:data.month,
        source:data.source,readOnly:true,changedRecords:0,
        recordCount:data.recordCount,fieldNames:data.fieldNames,
        totalExpenseKopecks:null,
        monetaryTotalsVerified:false,reconciledToFinance:false,
        note:'Источник рекламы отвечает, но сумма не сверена с начислениями Ozon. Не вычитать из прибыли.'
      });
    }catch{return respond(503,{code:'ozon_ads_source_unavailable'});}
  };
}
export const onRequestGet=createOzonAdsExpenseHandler();
