import {verifySession} from '../auth/session.js';
import {calculateProfit,monthBounds} from './profit-model.js';

const headers={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff'};
const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const OWNER_SQL="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const TARGET='ce9dd331-929d-4c3e-9073-368de3346bc9';
const safe=n=>Number.isSafeInteger(n);
export function summarizeOzonFinanceReadiness(month,data,result){
  if(data?.target!==TARGET||!result||result.month!==month||
    !result.api||!result.financeCloseout||
    !Array.isArray(result.profit?.blockers))
    throw Error('invalid_canonical_finance_data');
  const a=result.api,r=result.report,details=result.dateCostEvidence,
    costs=data.configuration?.costs?.entries||[];
  if(!safe(a.coveredDays)||!safe(a.days)||a.coveredDays<0||
    a.coveredDays>a.days||typeof a.netVerified!=='boolean'||
    typeof a.detailVerified!=='boolean'||!safe(a.totalKopecks)&&
    a.totalKopecks!==null||!Array.isArray(costs)||
    !Array.isArray(result.skuRows)||!details||
    !safe(details.checkedSalesRows)||!safe(details.confirmedSalesRows)||
    details.confirmedSalesRows>details.checkedSalesRows)
    throw Error('invalid_canonical_finance_data');
  const reportTotal=r?.totalKopecks??null,apiTotal=a.totalKopecks;
  const aggregateMatched=!!r&&safe(reportTotal)&&safe(apiTotal)&&
    reportTotal===apiTotal;
  const datedConfirmed=costs.filter(x=>x?.status==='confirmed'&&
    typeof x.validFrom==='string'&&safe(x.costKopecks)).length;
  const missingCostProducts=(result.skuRows||[]).filter(x=>
    x?.costStatus==='missing'&&typeof x.sku==='string')
    .slice(0,12).map(x=>({sku:x.sku.slice(0,40),
      article:typeof x.article==='string'?x.article.slice(0,120):null,
      costStatus:'missing',autoAssignment:false}));
  const blockers=[...result.profit.blockers];
  if(!aggregateMatched&&!blockers.includes('report_api_mismatch'))
    blockers.push('report_api_aggregate_unverified');
  if(!a.netVerified&&!blockers.includes('api_net_unverified'))
    blockers.push('api_net_unverified');
  if(!a.detailVerified&&!blockers.includes('api_details_unverified'))
    blockers.push('api_details_unverified');
  return {code:'ozon_finance_readiness',readOnly:true,
    source:'CANONICAL_OZON_FINANCE_SYNC',
    month,
    report:r?{processedDays:r.periodVerified?a.days:null,
      records:r.rows,complete:r.periodVerified&&r.quantityVerified,
      reconciled:a.netVerified&&a.detailVerified,
      final:false,controlTotalKop:reportTotal}:null,
    accruals:{rows:a.records??0,coveredDays:a.coveredDays,
      expectedDays:a.days,totalKop:apiTotal,
      netVerified:a.netVerified,detailVerified:a.detailVerified},
    cogs:{confirmedEntries:datedConfirmed,
      soldSkus:r?result.skuRows.length:0,
      confirmedSoldSkus:r?result.skuRows.filter(x=>
        x.costStatus==='confirmed').length:0,
      checkedSalesRows:details.checkedSalesRows,
      confirmedSalesRows:details.confirmedSalesRows,
      dateEffectiveCostEntries:datedConfirmed,
      complete:details.complete===true},
    sourcesMatch:{apiVsXlsxKopecks:aggregateMatched,
      differenceKop:safe(reportTotal)&&safe(apiTotal)?
        reportTotal-apiTotal:null},
    missingCostProducts,blockers,
    externalVerificationRequired:result.financeCloseout.missing||[],
    netProfitVerified:false,changedRecords:0};
}
export function createOzonFinanceReadiness(){
  return async({request,env})=>{
    if(request.method!=='GET')return respond(405,{code:'method_not_allowed'});
    let url;try{url=new URL(request.url);}catch{return respond(400,{code:'invalid_scope'});}
    const month=url.searchParams.get('month');
    if(url.pathname!=='/api/ozon/finance-readiness'||
      url.searchParams.size!==1||typeof month!=='string'||
      !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month))
      return respond(400,{code:'invalid_closed_month'});
    let bounds;try{bounds=monthBounds(month);}catch{return respond(400,{code:'invalid_closed_month'});}
    if(Date.parse(bounds.end+'T00:00:00Z')>Date.now())
      return respond(400,{code:'invalid_closed_month'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
      !env.OZON_FINANCE_DB)
      return respond(503,{code:'owner_auth_unavailable'});
    let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return respond(401,{code:'owner_session_required'});}
    if(!sub)return respond(401,{code:'owner_session_required'});
    try{
      const owner=await env.OZON_FINANCE_DB.prepare(OWNER_SQL)
        .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return respond(403,{code:'owner_only'});
      if(typeof env.OZON_FINANCE_SYNC?.getProfitData!=='function')
        return respond(503,{code:'canonical_finance_unavailable'});
      const data=await env.OZON_FINANCE_SYNC.getProfitData(month);
      if(data?.target!==TARGET)return respond(503,{code:'canonical_finance_unavailable'});
      const result=calculateProfit({month,api:data.api,
        documents:data.configuration?.month,
        costs:data.configuration?.costs,
        expenses:data.configuration?.expenses,
        tax:data.configuration?.tax});
      return respond(200,summarizeOzonFinanceReadiness(month,data,result));
    }catch{return respond(503,{code:'canonical_finance_unavailable'});}
  };
}
export const onRequestGet=createOzonFinanceReadiness();
