import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const SQL="SELECT r.vendor_code sku,SUM(CASE WHEN r.seller_oper_name='Продажа' THEN r.quantity ELSE 0 END) sold,SUM(CASE WHEN r.seller_oper_name='Возврат' THEN r.quantity ELSE 0 END) returned,COUNT(*) operations FROM wb_finance_api_rows r JOIN wb_finance_api_reports p ON p.account_id=r.account_id AND p.report_id=r.report_id WHERE p.account_id=? AND p.date_from>=? AND p.date_to<? AND p.status='complete' AND r.seller_oper_name IN ('Продажа','Возврат') GROUP BY r.vendor_code ORDER BY sold DESC,r.vendor_code LIMIT 501";
export function validateWbSkuRows(rows){if(!Array.isArray(rows)||rows.length>500)throw Error('sku_coverage');const seen=new Set();for(const r of rows){if(typeof r.sku!=='string'||!r.sku.trim()||r.sku.length>200||seen.has(r.sku)||![r.sold,r.returned,r.operations].every(n=>Number.isSafeInteger(n)&&n>=0)||r.operations<1)throw Error('sku_coverage');seen.add(r.sku);}return rows;}
export function createWbSalesSku({now=Date.now}={}){
 return async({request,env})=>{
 if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
 const u=new URL(request.url),month=u.searchParams.get('month');
 if(u.pathname!=='/api/wb/sales-sku'||u.searchParams.size!==1||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))return json(400,{code:'invalid_month'});
 const start=month+'-01',end=new Date(start+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);
 if(end.getTime()>now())return json(400,{code:'period_not_closed'});
 if(!env.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)return json(503,{code:'sources_unavailable'});
 try{
 const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);if(!sub)return json(401,{code:'unauthorized'});
 const owner=await env.OZON_FINANCE_DB.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1").bind(sub,env.OFFICE_ALLOWED_EMAIL).first();if(owner?.allowed!==1)return json(403,{code:'forbidden'});
 const db=env.WB_REPORT_SNAPSHOT_DB,until=end.toISOString().slice(0,10);
 const reports=await db.prepare("SELECT report_id,report_type,date_from,date_to,status,row_count,sales_count,returns_count FROM wb_finance_api_reports WHERE account_id=? AND date_from<? AND date_to>=? ORDER BY date_from LIMIT 301").bind(WB_ACCOUNT,until,start).all();
 const list=reports.results;if(!Array.isArray(list)||!list.length||list.length>300)throw Error('coverage');
 const days=new Map([[1,new Set()],[2,new Set()]]);let expectedOps=0;
 for(const r of list){if(r.status!=='complete'||!days.has(r.report_type)||r.date_from<start||r.date_to>=until||r.date_from>r.date_to||![r.sales_count,r.returns_count,r.row_count].every(n=>Number.isSafeInteger(n)&&n>=0)||r.sales_count+r.returns_count>r.row_count)throw Error('coverage');expectedOps+=r.sales_count+r.returns_count;for(let t=Date.parse(r.date_from+'T00:00:00Z');t<=Date.parse(r.date_to+'T00:00:00Z');t+=86400000){if(days.get(r.report_type).has(t))throw Error('overlap');days.get(r.report_type).add(t);}}
 const expectedDays=(end-Date.parse(start+'T00:00:00Z'))/86400000;if([...days.values()].some(s=>s.size!==expectedDays))throw Error('coverage');
 const rows=validateWbSkuRows((await db.prepare(SQL).bind(WB_ACCOUNT,start,until).all()).results);
 if(rows.reduce((n,r)=>n+r.operations,0)!==expectedOps)throw Error('operation_mismatch');
 return json(200,{code:'wb_sales_sku',month,readOnly:true,changedRecords:0,coverageComplete:true,rows});
 }catch{return json(503,{code:'sku_coverage_unavailable'});}
 };
}
export const onRequestGet=createWbSalesSku();
