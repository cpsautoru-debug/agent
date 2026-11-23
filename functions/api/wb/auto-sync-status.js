import {verifySession} from '../auth/session.js';
import {
  ACCOUNT,REPORT_LIMIT,summarizeWbFinance
} from '../../../web/office/wb-finance-monitor-core.mjs';

const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Vary':'Cookie, Origin'
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});

// Only existing staging D1 records. No Wildberries API calls, no writes,
// no XLSX double count, no automatic manipulation of D1 synchronization state.
// Finance data and report identifiers are returned ONLY to an authenticated
// Google-owner session explicitly present in office_authorized_users.
export function createWbFinanceMonitorHandler({now=Date.now}={}){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    try{
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
        !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
        env.WB_REPORT_ACCOUNT_ID!==ACCOUNT)
        return json(503,{code:'configuration_unavailable'});

      const googleSub=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!googleSub)return json(401,{code:'unauthorized'});
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(googleSub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'forbidden'});

      const db=env.WB_REPORT_SNAPSHOT_DB;
      const runtime=await db.prepare(
        'SELECT last_list_day,list_offset,last_request_ms,last_status,updated_at FROM wb_finance_api_runtime WHERE account_id=?'
      ).bind(ACCOUNT).first();
      // Avoid misrepresenting a truncated report list as a complete inventory.
      const reportResult=await db.prepare(
        'SELECT report_id,date_from,date_to,report_type,bank_payment_kop,status,'+
        'row_count,sales_count,returns_count,api_calculated_payment_kop,'+
        'error_code,updated_at FROM wb_finance_api_reports WHERE account_id=? '+
        'ORDER BY date_to DESC,report_id DESC LIMIT '+(REPORT_LIMIT+1)
      ).bind(ACCOUNT).all();
      const operations=await db.prepare(
        'SELECT COUNT(*) AS count FROM wb_finance_api_rows WHERE account_id=?'
      ).bind(ACCOUNT).first();
      if(!Array.isArray(reportResult?.results)||
        reportResult.results.length>REPORT_LIMIT||
        !Number.isSafeInteger(operations?.count)||operations.count<0)
        return json(503,{code:'wb_api_sync_monitor_incomplete'});
      if(!runtime){
        if(reportResult.results.length||operations.count)
          return json(503,{code:'wb_api_sync_monitor_inconsistent'});
        return json(200,{
          ...summarizeWbFinance({
            last_status:'never_run',last_request_ms:0,
            last_list_day:'',list_offset:0,updated_at:null
          },[],0,now())
        });
      }
      const summary=summarizeWbFinance(
        runtime,reportResult.results,operations.count,now());
      // Explain an exactly attributable payout difference by stored paid
      // acceptance charges. Read-only: report status must remain "mismatch"
      // until the normal ingestion/reconciliation worker recalculates it.
      const evidence=[];
      for(const report of summary.reports.filter(r=>r.status==='mismatch').slice(0,3)){
        if(!Number.isSafeInteger(report.calculatedPaymentKop)||
          !Number.isSafeInteger(report.bankPaymentKop))continue;
        const totals=await db.prepare(
          'SELECT COUNT(*) AS row_count, COALESCE(SUM(paid_acceptance_kop),0) AS paid_acceptance_kop '+
          'FROM wb_finance_api_rows WHERE account_id=? AND report_id=?'
        ).bind(ACCOUNT,report.reportId).first();
        if(!totals||!Number.isSafeInteger(totals.row_count)||
          !Number.isSafeInteger(totals.paid_acceptance_kop)||
          totals.row_count!==report.rowCount||
          totals.paid_acceptance_kop<=0)continue;
        const difference=report.calculatedPaymentKop-report.bankPaymentKop;
        if(difference!==totals.paid_acceptance_kop)continue;
        evidence.push({reportId:report.reportId,
          differenceKop:difference,
          paidAcceptanceKop:totals.paid_acceptance_kop,
          rowCount:totals.row_count,
          status:'PAYOUT_DIFFERENCE_EXACTLY_PAID_ACCEPTANCE',
          correctionApplied:false});
      }
      return json(200,{...summary,payoutDifferenceEvidence:evidence});
    }catch{
      return json(503,{code:'wb_api_sync_status_unavailable'});
    }
  };
}
export const onRequestGet=createWbFinanceMonitorHandler();
