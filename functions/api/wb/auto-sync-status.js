import { verifySession } from '../auth/session.js';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie, Origin'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});
// Reads a distinct API table; immutable XLSX snapshots are never summed into API totals.
export async function onRequestGet({request,env}){
  try{
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
      !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
      env.WB_REPORT_ACCOUNT_ID!=='4271851')
      return json(503,{code:'configuration_unavailable'});
    const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
    if(!sub)return json(401,{code:'unauthorized'});
    const owner=await env.OZON_FINANCE_DB.prepare(
      "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
    ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
    if(owner?.allowed!==1)return json(403,{code:'forbidden'});
    const runtime=await env.WB_REPORT_SNAPSHOT_DB.prepare(
      'SELECT last_list_day,last_status,updated_at FROM wb_finance_api_runtime WHERE account_id=?'
    ).bind(env.WB_REPORT_ACCOUNT_ID).first();
    const result=await env.WB_REPORT_SNAPSHOT_DB.prepare(
      'SELECT report_id,date_from,date_to,report_type,bank_payment_kop,status,row_count,sales_count,returns_count,api_calculated_payment_kop,updated_at FROM wb_finance_api_reports WHERE account_id=? ORDER BY date_from,report_id LIMIT 300'
    ).bind(env.WB_REPORT_ACCOUNT_ID).all();
    const reports=(result.results||[]).map(x=>({
      reportId:x.report_id,dateFrom:x.date_from,dateTo:x.date_to,
      reportType:x.report_type,status:x.status,bankPaymentKop:x.bank_payment_kop,
      rowCount:x.row_count,sales:x.sales_count,returns:x.returns_count,
      calculatedPaymentKop:x.api_calculated_payment_kop,
      updatedAt:x.updated_at
    }));
    const verified=reports.filter(x=>x.status==='complete');
    return json(200,{
      code:'wb_api_sync_status',source:'WB_FINANCE_API',readOnly:true,
      lastListingDate:runtime?.last_list_day||null,
      lastJobStatus:runtime?.last_status||'not_started',
      lastStateChange:runtime?.updated_at||null,
      reportCount:reports.length,completedCount:verified.length,
      totalBankPaymentKop:verified.reduce((total,row)=>total+row.bankPaymentKop,0),
      sumScope:'API_COMPLETED_REPORTS_ONLY_DO_NOT_ADD_XLSX',
      costStatus:'COST_CATALOG_NOT_YET_ATTACHED',
      netProfitStatus:'NOT_CALCULATED',
      reports
    });
  }catch{return json(503,{code:'wb_api_sync_status_unavailable'});}
}
