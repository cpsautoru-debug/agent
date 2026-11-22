import {verifySession} from '../auth/session.js';
import {classifyWbReportMonth} from '../../../web/office/wb-report-month-boundaries-core.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const HEADER={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADER});
const SQL='SELECT report_id,date_from,date_to,status,bank_payment_kop,row_count '+
  'FROM wb_finance_api_reports WHERE account_id=? ORDER BY date_from,report_id LIMIT 2001';
export function createWbMonthBoundaryHandler(){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    try{
      const url=new URL(request.url);
      if(url.origin!==ORIGIN||url.pathname!=='/api/wb/report-month-boundaries'||
        url.hash||url.searchParams.size!==1||
        [...url.searchParams.keys()][0]!=='month'||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get('month')||''))
        return json(400,{code:'invalid_period'});
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
        !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
        env.WB_REPORT_ACCOUNT_ID!=='4271851')
        return json(503,{code:'configuration_unavailable'});
      const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!actor)return json(401,{code:'unauthorized'});
      const allowed=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
      ).bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
      if(allowed?.allowed!==1)return json(403,{code:'forbidden'});
      const result=await env.WB_REPORT_SNAPSHOT_DB.prepare(SQL).bind('4271851').all();
      if(!Array.isArray(result?.results)||result.results.length>2000)
        return json(503,{code:'wb_report_metadata_incomplete'});
      const summary=classifyWbReportMonth(result.results,url.searchParams.get('month'));
      return json(200,summary);
    }catch{
      return json(503,{code:'wb_report_month_audit_unavailable'});
    }
  };
}
export const onRequestGet=createWbMonthBoundaryHandler();
