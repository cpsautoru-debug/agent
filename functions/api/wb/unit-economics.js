import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT,MAX_GROUPS,MAX_COSTS,calculateWbSkuBreakdown}
  from '../../../web/office/wb-unit-economics-core.mjs';
const HEADERS={
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Vary':'Cookie, Origin'
};
const json=(code,body)=>new Response(JSON.stringify(body),{status:code,headers:HEADERS});
const ownerQuery="SELECT 1 AS allowed FROM office_authorized_users "+
  "WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
// Group by report first: weekly reports may cross calendar months, so
// never silently infer that these are a complete calendar-month P&L.
const GROUP_SQL=[
"SELECT r.report_id AS report_id,r.vendor_code AS vendor_code,",
"p.date_from AS date_from,p.date_to AS date_to,p.status AS status,",
"COUNT(*) AS operation_count,",
"COALESCE(SUM(CASE WHEN r.seller_oper_name='Продажа' THEN r.quantity ELSE 0 END),0) AS sold_units,",
"COALESCE(SUM(CASE WHEN r.seller_oper_name='Возврат' THEN r.quantity ELSE 0 END),0) AS returned_units,",
"COALESCE(SUM(CASE WHEN r.seller_oper_name='Продажа' THEN r.for_pay_kop",
"WHEN r.seller_oper_name='Возврат' THEN -r.for_pay_kop ELSE 0 END),0) AS product_payout_kop,",
"COALESCE(SUM(r.delivery_service_kop+r.paid_storage_kop+",
"r.deduction_kop+r.penalty_kop),0) AS platform_fees_kop,",
"COALESCE(SUM(r.additional_payment_kop),0) AS additional_payment_kop,",
"COALESCE(SUM(r.paid_acceptance_kop),0) AS paid_acceptance_kop",
"FROM wb_finance_api_rows r",
"JOIN wb_finance_api_reports p",
"ON p.account_id=r.account_id AND p.report_id=r.report_id",
"WHERE r.account_id=? AND p.status='complete'",
"GROUP BY r.report_id,r.vendor_code,p.date_from,p.date_to,p.status",
"ORDER BY r.report_id,r.vendor_code",
"LIMIT "+(MAX_GROUPS+1)
].join(' ');
const STATS_SQL=[
"SELECT COALESCE(SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END),0) AS complete_reports,",
"COALESCE(SUM(CASE WHEN status IN('pending','paging') THEN 1 ELSE 0 END),0) AS pending_reports,",
"COALESCE(SUM(CASE WHEN status='complete' THEN bank_payment_kop ELSE 0 END),0) AS bank_payout_kop,",
"COALESCE(SUM(CASE WHEN status='complete' THEN row_count ELSE 0 END),0) AS completed_operations",
"FROM wb_finance_api_reports WHERE account_id=?"
].join(' ');
const COST_SQL=[
"SELECT vendor_code,valid_from,valid_to,cost_kopecks,status,source",
"FROM wb_profit_unit_costs WHERE account_id=?",
"ORDER BY vendor_code,valid_from LIMIT "+(MAX_COSTS+1)
].join(' ');
export function createWbUnitEconomicsHandler({now=Date.now}={}){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    try{
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
        !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
        env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
        return json(503,{code:'configuration_unavailable'});
      const url=new URL(request.url);
      if(url.search||url.hash)return json(400,{code:'scope_not_supported'});
      const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!sub)return json(401,{code:'unauthorized'});
      const owner=await env.OZON_FINANCE_DB.prepare(ownerQuery)
        .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'forbidden'});

      const db=env.WB_REPORT_SNAPSHOT_DB;
      const [stats,groupsRaw]=await Promise.all([
        db.prepare(STATS_SQL).bind(WB_ACCOUNT).first(),
        db.prepare(GROUP_SQL).bind(WB_ACCOUNT).all()
      ]);
      if(!stats||!Array.isArray(groupsRaw?.results)||
        groupsRaw.results.length>MAX_GROUPS)
        return json(503,{code:'wb_profit_coverage_unavailable'});
      let costRows=[],costRegistry='ready';
      try{
        const costRaw=await db.prepare(COST_SQL).bind(WB_ACCOUNT).all();
        if(!Array.isArray(costRaw?.results)||costRaw.results.length>MAX_COSTS)
          return json(503,{code:'wb_profit_cost_register_incomplete'});
        costRows=costRaw.results;
      }catch(e){
        // Only a not-yet-applied additive migration is recoverable.
        if(!/no such table:\s*wb_profit_unit_costs/i.test(String(e?.message||'')))
          throw e;
        costRegistry='migration_required';
      }
      const summary=calculateWbSkuBreakdown(groupsRaw.results,costRows,stats);
      return json(200,{
        code:'wb_unit_economics_preview',source:'WB_FINANCE_API_D1',
        readOnly:true,changedRecords:0,asOfMs:now(),
        costRegistry,profitVerified:false,
        ...summary
      });
    }catch{
      return json(503,{code:'wb_profitability_unavailable'});
    }
  };
}
export const onRequestGet=createWbUnitEconomicsHandler();
