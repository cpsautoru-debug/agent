import {verifySession} from '../auth/session.js';
import {calculateProfit,monthBounds} from './profit-model.js';

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
export function createOzonAdsExpenseHandler({fetcher=null,now=Date.now}={}){
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
    if(typeof env.ADS_READ_TOKEN!=='string')
      return respond(503,{code:'ads_bridge_secret_missing'});
    if(env.ADS_READ_TOKEN.length<32)
      return respond(503,{code:'ads_bridge_secret_too_short'});
    // Secret rotation requires a fresh Pages deployment to activate bindings.
    // Production binding targets the named OzonAdsInternal WorkerEntrypoint.
    // Internal Cloudflare Service Binding avoids unreliable same-account
    // workers.dev HTTP subrequests. Fail closed until Pages Production binds it.
    if(!env?.OZON_ADS_WORKER||typeof env.OZON_ADS_WORKER.expensePreview!=='function')
      return respond(503,{code:'ads_service_binding_missing'});
    let phase='request_setup';
    try{
      const upstream=new URL('/api/internal/expense',WORKER_ORIGIN);
      upstream.searchParams.set('month',url.searchParams.get('month'));
      const headers={authorization:'Bearer '+env.ADS_READ_TOKEN,accept:'application/json'};
      // RPC against the named WorkerEntrypoint avoids HTTP fetch() on a
      // named Service Binding. Only the injected fetcher in unit tests uses URL.
      // No caller-supplied upstream URL or secret is accepted.
      const upstreamUrl=upstream.toString();
      phase='service_binding_rpc';
      const result=fetcher
        ? await fetcher(upstreamUrl,{
            method:'GET',redirect:'error',headers,
            signal:AbortSignal.timeout(17000)
          })
        : await (async()=>{
            const rpc=await env.OZON_ADS_WORKER.expensePreview(
              url.searchParams.get('month'),env.ADS_READ_TOKEN);
            if(!rpc||!Number.isInteger(rpc.status)||rpc.status<200||
              rpc.status>599||!rpc.body||typeof rpc.body!=='object'||
              Array.isArray(rpc.body))
              return respond(503,{code:'ozon_ads_rpc_response_unrecognized'});
            return respond(rpc.status,rpc.body);
          })();
      phase='upstream_response';
      // Upstream status is mapped to fixed codes; raw body never forwarded
      // when source errors (could contain external provider details).
      if(!result.ok){
        if(result.status===401)return respond(503,{code:'ads_bridge_token_rejected'});
        // The ads Worker emits only fixed error codes, never raw upstream Ozon
        // text. Forward just those known diagnostic labels to the owner UI.
        const allow=new Set([
          'private_access_not_configured',
          'ozon_credentials_missing',
          'ozon_performance_auth_rejected',
          'ozon_performance_token_unavailable',
          'ozon_performance_token_unrecognized',
          'ozon_performance_expense_unauthorized',
          'ozon_performance_rate_limited',
          'ozon_performance_expense_unavailable',
          'ozon_performance_network_or_schema_error',
          'ozon_expense_schema_unverified',
          'ozon_expense_rows_unrecognized',
          'invalid_closed_month'
        ]);
        let code='ozon_ads_source_unavailable';
        try{
          if((result.headers.get('content-type')||'').includes('application/json')){
            const failure=await result.json();
            if(typeof failure?.code==='string'&&allow.has(failure.code))
              code=failure.code;
          }
        }catch{}
        if(code==='ozon_ads_source_unavailable'){
          if(result.status===404)return respond(503,{code:'ozon_ads_worker_route_not_found'});
          if(result.status===429)return respond(503,{code:'ozon_ads_worker_rate_limited'});
          if(result.status>=500)return respond(503,{code:'ozon_ads_worker_http_error'});
        }
        return respond(503,{code});
      }
      if(!(result.headers.get('content-type')||'').includes('application/json'))
        return respond(503,{code:'ozon_ads_response_unrecognized'});
      phase='upstream_json';
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
      // Do NOT use the obsolete office ozon_accruals_export table here.
      // The canonical Finance service is bound to an independent D1 database.
      // Compare raw Performance columns with the owner-confirmed XLSX
      // advertising rows, never subtract either sum a second time.
      const month=url.searchParams.get('month');
      let finance,financeSource,profit;
      try{
        const rpc=env.OZON_FINANCE_SYNC;
        if(!rpc||typeof rpc.getProfitData!=='function')
          return respond(503,{code:'ozon_ads_canonical_finance_unavailable'});
        financeSource=await rpc.getProfitData(month);
        if(financeSource?.target!=='ce9dd331-929d-4c3e-9073-368de3346bc9')
          return respond(503,{code:'ozon_ads_canonical_finance_unavailable'});
        profit=calculateProfit({month,api:financeSource.api,
          documents:financeSource.configuration?.month,
          costs:financeSource.configuration?.costs,
          expenses:financeSource.configuration?.expenses,
          tax:financeSource.configuration?.tax});
        const reportRows=profit.advertisingAudit?.reportAdvertisingRows;
        if(!Array.isArray(reportRows)||
          reportRows.some(r=>!Number.isSafeInteger(r.amountKopecks)||
            typeof r.date!=='string'))
          return respond(503,{code:'ozon_ads_canonical_finance_unavailable'});
        let adKop=0;
        for(const row of reportRows){
          adKop+=row.amountKopecks;
          if(!Number.isSafeInteger(adKop))
            return respond(503,{code:'ozon_ads_canonical_finance_unavailable'});
        }
        const bounds=monthBounds(month);
        const totalMatches=profit.report!==null&&
          Number.isSafeInteger(profit.report.totalKopecks)&&
          profit.report.totalKopecks===financeSource.api.totalKopecks;
        const dates=[...new Set(reportRows.map(r=>r.date))].sort();
        finance={
          source:'CANONICAL_OZON_FINANCE_XLSX',
          month,
          accrualRows:profit.report?.rows??0,
          advertisingRows:reportRows.length,
          advertisingAccrualKopecks:adKop,
          firstDate:dates[0]||null,lastDate:dates.at(-1)||null,
          daysWithAdvertisingRows:dates.length,
          daysInMonth:bounds.days,
          financeApiCoveredDays:financeSource.api.coveredDays,
          sourceTotalsMatched:totalMatches,
          matchedToPerformance:false,
          reconciled:false
        };
      }catch{
        return respond(503,{code:'ozon_ads_canonical_finance_unavailable'});
      }
      // Require exact, non-derived column diagnostics when the Worker
      // provides them. Older Worker deployments may omit them.
      const fields=['moneySpent','bonusSpent','prepaymentSpent'];
      const audit=data.columnAudit;
      if(audit!==undefined&&(!Array.isArray(audit)||audit.length!==3||
        audit.some((x,i)=>!x||x.field!==fields[i]||
          !Number.isSafeInteger(x.validRows)||x.validRows<0||
          !Number.isSafeInteger(x.missingRows)||x.missingRows<0||
          !Number.isSafeInteger(x.invalidRows)||x.invalidRows<0||
          x.validRows+x.missingRows+x.invalidRows!==data.recordCount||
          !x.invalidFormats||typeof x.invalidFormats!=='object'||
          ['object','array','boolean','decimalPrecision','other'].some(k=>
            !Number.isSafeInteger(x.invalidFormats[k])||x.invalidFormats[k]<0)||
          Object.values(x.invalidFormats).reduce((s,n)=>s+n,0)!==x.invalidRows||
          (x.rawColumnSumKopecks!==null&&!Number.isSafeInteger(x.rawColumnSumKopecks))||
          x.sourceReconciled!==false)))
        return respond(503,{code:'ozon_ads_column_audit_unrecognized'});
      // Only allowlisted diagnostic fields reach the UI. These are
      // independent accruals, not matched campaign/payment transactions.
      return respond(200,{
        code:'ozon_ads_office_preview',month:data.month,
        source:data.source,readOnly:true,changedRecords:0,
        recordCount:data.recordCount,fieldNames:data.fieldNames,
        columnAudit:audit===undefined?null:audit.map(x=>({
          field:x.field,validRows:x.validRows,missingRows:x.missingRows,
          invalidRows:x.invalidRows,invalidFormats:{
            object:x.invalidFormats.object,array:x.invalidFormats.array,
            boolean:x.invalidFormats.boolean,decimalPrecision:x.invalidFormats.decimalPrecision,
            other:x.invalidFormats.other},
          rawColumnSumKopecks:x.rawColumnSumKopecks,sourceReconciled:false
        })),
        financeAudit:finance,
        totalExpenseKopecks:null,
        monetaryTotalsVerified:false,reconciledToFinance:false,
        note:'Источник рекламы отвечает, но сумма не сверена с начислениями Ozon. Не вычитать из прибыли.'
      });
    }catch(error){
      // Only deterministic, non-sensitive categories reach the owner.
      // Never expose exception messages or bearer credentials in responses.
      const message=String(error?.message||'').toLowerCase();
      const code=/(entrypoint|export|rpc method|not a function)/.test(message)
        ? 'ozon_ads_binding_entrypoint_error'
        : /(fetch failed|network|connection|socket|dns|unreachable)/.test(message)
        ? 'ozon_ads_binding_network_error'
        : error?.name==='TypeError'
        ? 'ozon_ads_binding_type_error'
        : 'ozon_ads_transport_failure';
      return respond(503,{code,phase});
    }
  };
}
export const onRequestGet=createOzonAdsExpenseHandler();
