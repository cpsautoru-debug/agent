import {json,verifyYandexOwner} from './finance-source.js';
import {onRequestGet as auditReport} from './report-audit.js';
import {sadOrderReview} from '../../../web/office/shop-unit-evidence.mjs';
const SQL="SELECT month,scope,report_type,report_id,status FROM yandex_finance_report_jobs WHERE month=? AND ((scope='all' AND report_type='orders') OR (scope='149082506' AND report_type='realization')) LIMIT 3";
const idRule=/^[a-zA-Z0-9_-]{1,255}$/;
export function createSadOrderReviewHandler({audit=auditReport,authorize=verifyYandexOwner,now=Date.now}={}){
 return async({request,env})=>{
 const u=new URL(request.url),month=u.searchParams.get('month');
 if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
 if(u.pathname!=='/api/yandex/sad-order-review'||u.hash||u.searchParams.size!==1||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||'')||month<'2026-10'||month>=new Date(now()).toISOString().slice(0,7))return json(400,{code:'invalid_month'});
 const auth=await authorize(request,env);if(auth)return json(auth.status,{code:auth.code});
 const unavailable=(reason,status=200)=>json(status,{code:'sad_order_review_unavailable',reason,month,readOnly:true,changedRecords:0});
 try{
 const read=async()=>{const r=await env.OZON_FINANCE_DB.prepare(SQL).bind(month).all();if(!Array.isArray(r?.results))throw Error('registry');return r.results;};
 const rows=await read();
 const pick=(scope,type)=>rows.filter(x=>x.month===month&&x.scope===scope&&x.report_type===type);
 const a=pick('all','orders'),b=pick('149082506','realization');
 if(a.length!==1||a[0].status!=='DONE'||!idRule.test(a[0].report_id||''))return unavailable('orders_registry_not_ready');
 if(b.length!==1||b[0].status!=='DONE'||!idRule.test(b[0].report_id||''))return unavailable('sad_realization_registry_not_ready');
 const selected=[a[0],b[0]];
 const results=await Promise.all(selected.map(x=>audit({request:new Request(u.origin+'/api/yandex/report-audit?reportId='+encodeURIComponent(x.report_id),{headers:{Cookie:request.headers.get('Cookie')||''}}),env})));
 if(!results[0].ok)return unavailable('orders_archive_unavailable',503);
 if(!results[1].ok)return unavailable('sad_archive_unavailable',503);
 const [orders,realization]=await Promise.all(results.map(r=>r.json()));
 if(orders?.code!=='yandex_report_archive_audited')return unavailable('orders_archive_not_verified');
 if(realization?.code!=='yandex_report_archive_audited')return unavailable('sad_archive_not_verified');
 const latest=await read();
 if(latest.length!==2||!selected.every(x=>latest.some(y=>y.month===x.month&&y.scope===x.scope&&y.report_type===x.report_type&&y.report_id===x.report_id&&y.status==='DONE')))return unavailable('report_registry_changed');
 const jobs={code:'yandex_report_jobs_saved',readOnly:true,jobs:selected.map(x=>({month:x.month,scope:x.scope,reportType:x.report_type,status:x.status}))};
 const result=sadOrderReview(month,jobs,orders,realization);
 if(!result)return unavailable('order_ledger_coverage_invalid');
 return json(200,{code:'sad_order_review',month,campaignId:149082506,readOnly:true,changedRecords:0,...result});
 }catch{return unavailable('review_source_unavailable',503);}
 };
}
export const onRequestGet=createSadOrderReviewHandler();
