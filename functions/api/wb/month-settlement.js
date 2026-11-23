import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
import {calculateWbMonthSettlement} from '../../../web/office/wb-month-settlement-core.mjs';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const OWNER="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const REPORT_SQL=[
 "SELECT p.report_id,p.report_type,p.date_from,p.date_to,p.status,p.row_count,",
 "COUNT(r.rrd_id) observed_rows,p.bank_payment_kop,p.api_calculated_payment_kop,",
 "COALESCE(SUM(CASE WHEN r.seller_oper_name='Продажа' THEN r.for_pay_kop ELSE 0 END),0) sale_kop,",
 "COALESCE(SUM(CASE WHEN r.seller_oper_name='Возврат' THEN r.for_pay_kop ELSE 0 END),0) return_kop,",
 "COALESCE(SUM(CASE WHEN r.seller_oper_name NOT IN ('Продажа','Возврат') THEN r.for_pay_kop ELSE 0 END),0) other_payout_kop,",
 "COALESCE(SUM(r.delivery_service_kop),0) delivery_kop,",
 "COALESCE(SUM(r.paid_storage_kop),0) storage_kop,",
 "COALESCE(SUM(r.deduction_kop),0) deduction_kop,",
 "COALESCE(SUM(r.penalty_kop),0) penalty_kop,",
 "COALESCE(SUM(r.additional_payment_kop),0) additional_kop,",
 "COALESCE(SUM(r.paid_acceptance_kop),0) acceptance_kop",
 "FROM wb_finance_api_reports p LEFT JOIN wb_finance_api_rows r",
 "ON r.account_id=p.account_id AND r.report_id=p.report_id",
 "WHERE p.account_id=? AND p.date_from>=? AND p.date_to<?",
 "GROUP BY p.account_id,p.report_id",
 "ORDER BY p.date_from,p.report_type,p.report_id LIMIT 301"
].join(' ');
const COST_SQL=[
 "SELECT COUNT(DISTINCT r.vendor_code) AS sold_articles,",
 "COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM wb_profit_unit_costs c",
 "WHERE c.account_id=r.account_id AND c.vendor_code=r.vendor_code",
 "AND c.status='confirmed' AND c.valid_from<=p.date_from",
 "AND (c.valid_to IS NULL OR c.valid_to>=p.date_to))",
 "THEN r.vendor_code END) AS confirmed_articles,",
 "COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM wb_profit_unit_costs c",
 "WHERE c.account_id=r.account_id AND c.vendor_code=r.vendor_code",
 "AND c.status='preliminary' AND c.valid_from<=p.date_from",
 "AND (c.valid_to IS NULL OR c.valid_to>=p.date_to))",
 "THEN r.vendor_code END) AS preliminary_articles",
 "FROM wb_finance_api_rows r JOIN wb_finance_api_reports p",
 "ON p.report_id=r.report_id AND p.account_id=r.account_id",
 "WHERE p.account_id=? AND p.date_from>=? AND p.date_to<?",
 "AND p.status='complete' AND r.seller_oper_name='Продажа'"
].join(' ');
export function createWbMonthSettlement({now=Date.now}={}){
 return async function({request,env}){
  if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
  const url=new URL(request.url),month=url.searchParams.get('month');
  if(url.pathname!=='/api/wb/month-settlement'||url.hash||
    url.searchParams.size!==1||
    !/^20\\d{2}-(0[1-9]|1[0-2])$/.test(month||''))
   return json(400,{code:'invalid_month'});
  const start=month+'-01',next=new Date(start+'T00:00:00Z');
  next.setUTCMonth(next.getUTCMonth()+1);
  if(next.getTime()>now())return json(400,{code:'period_not_closed'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
     !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
     env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
   return json(503,{code:'sources_unavailable'});
  let sub;
  try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return json(401,{code:'unauthorized'});}
  if(!sub)return json(401,{code:'unauthorized'});
  try{
   const o=await env.OZON_FINANCE_DB.prepare(OWNER)
     .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(o?.allowed!==1)return json(403,{code:'forbidden'});
  }catch{return json(503,{code:'owner_auth_unavailable'});}
  try{
   const db=env.WB_REPORT_SNAPSHOT_DB;
   const end=next.toISOString().slice(0,10);
   const [reports,costs]=await Promise.all([
     db.prepare(REPORT_SQL).bind(WB_ACCOUNT,start,end).all(),
     db.prepare(COST_SQL).bind(WB_ACCOUNT,start,end).first()
   ]);
   if(!Array.isArray(reports?.results)||reports.results.length>300||!costs)
     return json(503,{code:'wb_month_coverage_unavailable'});
   return json(200,calculateWbMonthSettlement(month,reports.results,costs));
  }catch{return json(503,{code:'wb_month_settlement_unavailable'});}
 };
}
export const onRequestGet=createWbMonthSettlement();
