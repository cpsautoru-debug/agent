import {json,verifyYandexOwner} from './finance-source.js';
import {onRequestGet as auditReport} from './report-audit.js';
import {buildYandexSafeSkuEvidence} from '../../../web/office/yandex-realization-cost-evidence.mjs';
export function createSadSalesSku({audit=auditReport,now=Date.now}={}){
 return async({request,env})=>{
 const u=new URL(request.url),month=u.searchParams.get('month');
 if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
 if(u.pathname!=='/api/yandex/sales-sku'||u.searchParams.size!==1||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||'')||month<'2026-10'||month>=new Date(now()).toISOString().slice(0,7))return json(400,{code:'invalid_month'});
 const auth=await verifyYandexOwner(request,env);if(auth)return json(auth.status,{code:auth.code});
 try{
 const job=await env.OZON_FINANCE_DB.prepare("SELECT report_id,status FROM yandex_finance_report_jobs WHERE month=? AND scope='149082506' AND report_type='realization'").bind(month).first();
 if(job?.status!=='DONE'||!(/^[a-zA-Z0-9_-]{1,255}$/).test(job.report_id||''))return json(200,{code:'sad_sales_unavailable',month,reason:'sad_report_not_ready',readOnly:true});
 const internal=new Request(u.origin+'/api/yandex/report-audit?reportId='+encodeURIComponent(job.report_id),{headers:{Cookie:request.headers.get('Cookie')||''}});
 const response=await audit({request:internal,env});
 if(!response.ok)return json(503,{code:'sad_sales_unavailable',month,reason:'archive_unavailable'});
 const evidence=buildYandexSafeSkuEvidence({month,rows:[]},{149082506:await response.json()});
 if(evidence.issues.length)return json(200,{code:'sad_sales_unavailable',month,reason:'quantity_coverage_incomplete',readOnly:true});
 return json(200,{code:'sad_sales_sku',month,campaignId:149082506,readOnly:true,changedRecords:0,coverageComplete:true,rows:evidence.rows.map(x=>({sku:x.shopSku,name:x.name,sold:x.deliveredUnits,returned:x.returnedUnits}))});
 }catch{return json(503,{code:'sad_sales_unavailable',month,reason:'source_unavailable'});}
 };
}
export const onRequestGet=createSadSalesSku();
