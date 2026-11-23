import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
import {reconcileWbOwnerCostSnapshots} from '../../../web/office/wb-owner-cost-reconciliation.mjs';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff'};
const reply=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const OWNER="SELECT 1 allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const SNAPSHOTS="SELECT report_id,source,snapshot_json FROM wb_saved_xlsx_reports WHERE account_id=? AND json_extract(snapshot_json,'$.periodStart')>='2026-10-01' AND json_extract(snapshot_json,'$.periodEnd')<='2026-10-31' ORDER BY report_id";
const SALES="SELECT r.vendor_code, SUM(CASE WHEN r.seller_oper_name='Продажа' THEN r.quantity ELSE 0 END) sold_units, SUM(CASE WHEN r.seller_oper_name='Возврат' THEN r.quantity ELSE 0 END) returned_units FROM wb_finance_api_rows r JOIN wb_finance_api_reports p ON p.account_id=r.account_id AND p.report_id=r.report_id WHERE p.account_id=? AND p.status='complete' AND p.date_from>='2026-10-01' AND p.date_to<='2026-10-31' AND r.seller_oper_name IN ('Продажа','Возврат') GROUP BY r.vendor_code HAVING sold_units>0 ORDER BY r.vendor_code";
export function buildOctoberWbSyncPlan(evidence,existing){
 if(evidence?.status!=='management_cost_reconciled'||
   evidence.scope!=='2026-10'||evidence.confirmedSkuCount!==35||
   evidence.confirmedSoldUnits!==173||
   evidence.resalableReturnedUnits!==6||
   evidence.netManufacturingCostKopecks!==39422300||
   !Array.isArray(evidence.costLines)||evidence.costLines.length!==35||
   !Array.isArray(existing))throw Error('wb_sync_source_unverified');
 const byCode=new Map();
 for(const row of existing){
  if(typeof row.vendor_code!=='string'||!row.vendor_code||
    !Number.isSafeInteger(row.cost_kopecks)||
    !['confirmed','preliminary'].includes(row.status)||
    typeof row.valid_from!=='string'||
    row.valid_to!==null&&typeof row.valid_to!=='string')
   throw Error('wb_sync_existing_invalid');
  const all=byCode.get(row.vendor_code)||[];all.push(row);
  byCode.set(row.vendor_code,all);
 }
 const inserts=[],closeOlder=[],existingConfirmed=[];
 for(const x of evidence.costLines){
  if(!Number.isSafeInteger(x.unitCostKopecks)||x.unitCostKopecks<=0)
   throw Error('wb_sync_cost_invalid');
  const previous=byCode.get(x.vendorCode)||[];
  const overlap=previous.filter(r=>r.valid_from<='2026-10-31'&&
    (r.valid_to===null||r.valid_to>='2026-10-01'));
  if(overlap.some(r=>r.cost_kopecks!==x.unitCostKopecks))
   throw Error('wb_sync_cost_conflict');
  if(overlap.some(r=>r.valid_from>'2026-10-01'))
   throw Error('wb_sync_historical_version_conflict');
  const same=overlap.find(r=>r.valid_from==='2026-10-01');
  if(same){
   if(same.status!=='confirmed'||same.valid_to!=='2026-10-31')
    throw Error('wb_sync_existing_october_invalid');
   existingConfirmed.push(x.vendorCode);continue;
  }
  const older=overlap.filter(r=>r.valid_from<'2026-10-01');
  if(older.some(r=>r.status!=='preliminary'||r.valid_to!==null)||
    older.length>1)throw Error('wb_sync_older_history_conflict');
  if(older.length)closeOlder.push(older[0].vendor_code);
  inserts.push({code:x.vendorCode,cost:x.unitCostKopecks});
 }
 if(inserts.length+existingConfirmed.length!==35)
  throw Error('wb_sync_count_mismatch');
 return {inserts,closeOlder,alreadyConfirmed:existingConfirmed};
}
export async function onRequestPost({request,env}){
 if(request.method!=='POST')return reply(405,{code:'method_not_allowed'});
 const url=new URL(request.url);
 if(url.pathname!=='/api/wb/cost-sync'||url.search||url.hash)
  return reply(400,{code:'invalid_scope'});
 const origin=request.headers.get('Origin');
 if(origin!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')
  return reply(403,{code:'origin_not_allowed'});
 if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
   env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
  return reply(503,{code:'configuration_unavailable'});
 let sub;
 try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
 catch{return reply(401,{code:'unauthorized'});}
 if(!sub)return reply(401,{code:'unauthorized'});
 try{
  const owner=await env.OZON_FINANCE_DB.prepare(OWNER)
   .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
  if(owner?.allowed!==1)return reply(403,{code:'forbidden'});
 }catch{return reply(503,{code:'owner_auth_unavailable'});}
 try{
  const db=env.WB_REPORT_SNAPSHOT_DB;
  const [snapshots,sales,old]=await Promise.all([
   db.prepare(SNAPSHOTS).bind(WB_ACCOUNT).all(),
   db.prepare(SALES).bind(WB_ACCOUNT).all(),
   db.prepare("SELECT vendor_code,valid_from,valid_to,cost_kopecks,status FROM wb_profit_unit_costs WHERE account_id=? AND (valid_to IS NULL OR valid_to>='2026-10-01')").bind(WB_ACCOUNT).all()
  ]);
  if(!Array.isArray(snapshots?.results)||!Array.isArray(sales?.results)||
    !Array.isArray(old?.results))throw Error('source_missing');
  const e=reconcileWbOwnerCostSnapshots('2026-10',snapshots.results,sales.results);
  const plan=buildOctoberWbSyncPlan(e,old.results);
  if(plan.inserts.length){
   const ops=[
    ...plan.closeOlder.map(code=>db.prepare(
      "UPDATE wb_profit_unit_costs SET valid_to='2026-09-30' WHERE account_id=? AND vendor_code=? AND valid_from<'2026-10-01' AND valid_to IS NULL AND status='preliminary'").bind(WB_ACCOUNT,code)),
    ...plan.inserts.map(x=>db.prepare(
      "INSERT INTO wb_profit_unit_costs(account_id,vendor_code,valid_from,valid_to,cost_kopecks,status,source,actor) VALUES (?,?, '2026-10-01','2026-10-31',?,'confirmed','WB_OWNER_CONFIRMED_XLSX_2026_10','owner_reconfirmation_2026_11_24')").bind(WB_ACCOUNT,x.code,x.cost))
   ];
   await db.batch(ops);
  }
  const checked=await db.prepare(
   "SELECT vendor_code,cost_kopecks,status FROM wb_profit_unit_costs WHERE account_id=? AND valid_from='2026-10-01' AND valid_to='2026-10-31' AND status='confirmed'"
  ).bind(WB_ACCOUNT).all();
  const actual=new Map((checked.results||[]).map(x=>[x.vendor_code,x.cost_kopecks]));
  if(actual.size!==35||e.costLines.some(x=>actual.get(x.vendorCode)!==x.unitCostKopecks))
   return reply(503,{code:'wb_sync_postwrite_verification_failed'});
  return reply(200,{code:'wb_cost_registry_synchronized',month:'2026-10',
   confirmedArticles:35,inserted:plan.inserts.length,
   alreadyConfirmed:plan.alreadyConfirmed.length,
   manufacturingCostKopecks:e.netManufacturingCostKopecks,
   note:'October only, owner-confirmed historical XLSX; no future price assumption.'});
 }catch{return reply(503,{code:'wb_sync_blocked_or_unavailable'});}
}
