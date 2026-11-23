import {verifySession} from '../auth/session.js';

const headers={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff'};
const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const OWNER_SQL="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const REPORT_SQL="SELECT period,processed_days,records_count,posting_kopecks,item_kopecks,non_item_kopecks,control_total_kopecks,complete,reconciled,final FROM ozon_finance_reports WHERE period=? LIMIT 1";
const ACCRUAL_SQL=`SELECT COUNT(*) AS rows_checked,
  COUNT(DISTINCT operation_date) AS observed_days,
  MIN(operation_date) AS first_day,MAX(operation_date) AS last_day,
  COALESCE(SUM(amount_kopecks),0) AS accrual_total_kopecks,
  COUNT(DISTINCT CASE WHEN category='Продажи' AND sku IS NOT NULL AND sku<>'' THEN sku END) AS sold_skus,
  COUNT(DISTINCT CASE WHEN category='Продажи' AND sku IS NOT NULL AND sku<>'' AND EXISTS (
    SELECT 1 FROM ozon_cost_entries c WHERE c.sku=a.sku AND c.status='confirmed'
  ) THEN sku END) AS covered_sold_skus
  FROM ozon_accruals a WHERE operation_date>=? AND operation_date<?`;
const COST_SQL="SELECT COUNT(*) AS n FROM ozon_cost_entries WHERE status='confirmed'";
const HISTORY_SQL="SELECT COUNT(*) AS n FROM ozon_sku_costs";
function monthBounds(m){
  if(!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(m))return null;
  const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);
  return {start:m+'-01',end:d.toISOString().slice(0,10),
    days:(d-Date.parse(m+'-01T00:00:00Z'))/86400000};
}
const safeInt=n=>Number.isSafeInteger(n)&&n>=0;
function validReport(r,days){
  return !r||(
    typeof r.period==='string'&&safeInt(r.processed_days)&&
    r.processed_days<=days&&safeInt(r.records_count)&&
    ['posting_kopecks','item_kopecks','non_item_kopecks',
      'control_total_kopecks'].every(x=>Number.isSafeInteger(r[x]))&&
    [r.complete,r.reconciled,r.final].every(x=>x===0||x===1)&&
    r.posting_kopecks+r.item_kopecks+r.non_item_kopecks===
      r.control_total_kopecks);
}
export function summarizeOzonFinanceReadiness(month,report,accrual,costs,history={n:0}){
  const bounds=monthBounds(month);
  if(!bounds||!validReport(report,bounds.days)||
    !accrual||!costs||
    !['rows_checked','observed_days','sold_skus','covered_sold_skus']
      .every(x=>safeInt(accrual[x]))||
    !Number.isSafeInteger(accrual.accrual_total_kopecks)||
    !safeInt(costs.n)||!history||!safeInt(history.n)||
    accrual.observed_days>bounds.days||
    accrual.covered_sold_skus>accrual.sold_skus)
    throw Error('invalid_finance_audit_source');
  const blockers=[];
  const add=(key,condition)=>{if(condition)blockers.push(key);};
  add('report_missing',!report);
  add('report_days_incomplete',!!report&&
    (report.complete!==1||report.processed_days!==bounds.days));
  add('report_not_reconciled',!!report&&report.reconciled!==1);
  add('report_not_final',!!report&&report.final!==1);
  // DISTINCT operation dates are not sync coverage: days with zero activity
  // can be legitimately absent. Only an authoritative sync cursor/run can
  // establish that the source was loaded for every date.
  add('accrual_sync_coverage_unverified',true);
  add('costs_missing_for_sold_skus',
    accrual.covered_sold_skus!==accrual.sold_skus||
    accrual.sold_skus===0);
  add('date_effective_costs_missing',history.n===0);
  // Even with all database checks green, independent primary ad, return,
  // tax and bank documents must be reconciled. This audit does not assert
  // verified profit or equivalence of two different source granularities.
  return {code:'ozon_finance_readiness',readOnly:true,
    month,report:report?{
      processedDays:report.processed_days,
      records:report.records_count,complete:report.complete===1,
      reconciled:report.reconciled===1,final:report.final===1,
      controlTotalKop:report.control_total_kopecks
    }:null,
    accruals:{rows:accrual.rows_checked,
      observedDays:accrual.observed_days,expectedDays:bounds.days,
      observedDaysAreCoverage:false,
      firstDay:accrual.first_day||null,lastDay:accrual.last_day||null,
      totalKop:accrual.accrual_total_kopecks},
    cogs:{confirmedEntries:costs.n,dateEffectiveCostEntries:history.n,
      soldSkus:accrual.sold_skus,
      confirmedSoldSkus:accrual.covered_sold_skus},
    blockers,externalVerificationRequired:[
      'advertising_reconciliation','refund_and_return_recovery',
      'tax_register','bank_statement','expense_allocation',
      'date_effective_cost_and_quantity'
    ],netProfitVerified:false,changedRecords:0};
}
export function createOzonFinanceReadiness(){
  return async function onRequestGet({request,env}){
    if(request.method!=='GET')return respond(405,{code:'method_not_allowed'});
    const url=new URL(request.url),month=url.searchParams.get('month');
    const bounds=monthBounds(month||'');
    if(url.pathname!=='/api/ozon/finance-readiness'||
      url.searchParams.size!==1||!bounds||
      Date.parse(bounds.end+'T00:00:00Z')>Date.now())
      return respond(400,{code:'invalid_closed_month'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
      !env.OZON_FINANCE_DB)return respond(503,{code:'owner_auth_unavailable'});
    let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return respond(401,{code:'owner_session_required'});}
    if(!sub)return respond(401,{code:'owner_session_required'});
    try{
      const db=env.OZON_FINANCE_DB;
      const owner=await db.prepare(OWNER_SQL)
        .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return respond(403,{code:'owner_only'});
      const [report,accrual,costs,history]=await Promise.all([
        db.prepare(REPORT_SQL).bind(month).first(),
        db.prepare(ACCRUAL_SQL).bind(bounds.start,bounds.end).first(),
        db.prepare(COST_SQL).first(),
        db.prepare(HISTORY_SQL).first()
      ]);
      return respond(200,summarizeOzonFinanceReadiness(month,report,accrual,costs,history));
    }catch{return respond(503,{code:'finance_audit_unavailable'});}
  };
}
export const onRequestGet=createOzonFinanceReadiness();
