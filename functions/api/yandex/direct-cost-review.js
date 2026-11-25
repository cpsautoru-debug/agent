import {json,verifyYandexOwner,yandexRequest,
 listYandexCampaigns,selectedBusiness} from './finance-source.js';
import {onRequestGet as readOfficialReport}
 from './report-audit.js';
import {onRequestGet as readCostSources}
 from '../finance/cost-audit.js';
import {reconcileDirectYandexMonth}
 from '../../../web/office/yandex-direct-reconciliation-core.mjs';

const expected=[
 ['all','orders','orders'],
 ['all','services','services'],
 ['all','payments','payments'],
 ['149082506','realization','149082506'],
 ['149106500','realization','149106500']
];
const id=/^[a-zA-Z0-9_-]{1,255}$/;
const monthRule=/^20\d{2}-(0[1-9]|1[0-2])$/;
const pathFor=(request,path,search)=>{
 const url=new URL(request.url);
 url.pathname=path;url.search=search;
 return new Request(url,{method:'GET',headers:request.headers});
};
async function responseJSON(response){
 if(!response.ok)throw Error('source_http_error');
 const data=await response.json();
 if(!data||typeof data!=='object')throw Error('source_invalid');
 return data;
}
export function selectYandexMonthlyReportIds(rows,month){
 if(!Array.isArray(rows)||rows.length>20)return null;
 const result={};
 const scopes=typeof month==='string'&&month>='2026-10'?
  expected.filter(x=>x[2]!=='149106500'):expected;
 for(const [scope,type,key] of scopes){
  const matches=rows.filter(x=>x.scope===scope&&
   x.report_type===type&&x.status==='DONE'&&id.test(x.report_id||''));
  if(matches.length!==1)return null;
  result[key]=matches[0].report_id;
 }
 if(new Set(Object.values(result)).size!==scopes.length)return null;
 return result;
}
export async function onRequestGet({request,env}){
 if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
 const url=new URL(request.url),month=url.searchParams.get('month');
 // External chat links may append a harmless attribution parameter.
 // Allow exactly one month, plus only the known tracking parameter;
 // never accept duplicates or arbitrary finance query arguments.
 const keys=[...url.searchParams.keys()];
 const paramsValid=url.searchParams.getAll('month').length===1&&
  keys.every(k=>k==='month'||k==='utm_source')&&
  url.searchParams.getAll('utm_source').length<=1;
 if(url.pathname!=='/api/yandex/direct-cost-review'||url.hash||
    !paramsValid||!monthRule.test(month||'')||
    Date.UTC(Number(month?.slice(0,4)),
     Number(month?.slice(5,7)),1)>Date.now())
  return json(400,{code:'invalid_month'});
 const issue=await verifyYandexOwner(request,env);
 if(issue)return json(issue.status,{code:issue.code});
 try{
  const jobs=await env.OZON_FINANCE_DB.prepare(
   'SELECT scope,report_type,report_id,status FROM yandex_finance_report_jobs WHERE month=? LIMIT 21'
  ).bind(month).all();
  const ids=selectYandexMonthlyReportIds(jobs.results,month);
  if(!ids)return json(200,{code:'yandex_direct_cost_incomplete',
   month,status:'report_ids_incomplete',readOnly:true,
   netProfitKopecks:null,missing:[]});
  const keys=month>='2026-10'?
   ['orders','services','payments','149082506']:
   ['orders','services','payments','149082506','149106500'];
  const answers=await Promise.all([
   ...keys.map(k=>readOfficialReport({env,request:pathFor(request,
    '/api/yandex/report-audit','?reportId='+encodeURIComponent(ids[k]))})
    .then(responseJSON)),
   readCostSources({env,request:pathFor(request,
    '/api/finance/cost-audit','?month='+encodeURIComponent(month))})
    .then(responseJSON)
  ]);
  const results=Object.fromEntries(keys.map((key,i)=>[key,answers[i]]));
  const orders=results.orders,services=results.services,
   payments=results.payments,first=results['149082506'],
   second=results['149106500']??null,
   costAudit=answers[answers.length-1];
  for(const x of [orders,services,payments]){
   if(x.code!=='yandex_report_archive_audited'||
     x.readOnly!==true||x.changedRecords!==0)
    return json(200,{code:'yandex_direct_cost_incomplete',month,
     status:'financial_archives_not_audited',readOnly:true,
     netProfitKopecks:null,missing:[]});
  }
  if(costAudit.code!=='unified_finance_source_audit'||
     costAudit.readOnly!==true||costAudit.month!==month)
   return json(200,{code:'yandex_direct_cost_incomplete',month,
    status:'cost_sources_unavailable',readOnly:true,
    netProfitKopecks:null,missing:[]});
  const realizations={149082506:first,149106500:second};
  const base={orders,services,payments};
  // Only after an initial exact audit, ask the official seller catalog for
  // product titles of ACTUALLY missing delivered SKU, including generically
  // named products. Catalog purchase prices are NEVER used as COGS.
  const firstPass=reconcileDirectYandexMonth(
   month,base,realizations,costAudit);
  const unknown=firstPass.missing||[];
  const unique=[...new Set(unknown.map(x=>x.shopSku))]
   .filter(x=>typeof x==='string'&&x.length<=150);
  const catalogOfferNames={};
  if(unique.length>0&&unique.length<=100){
   try{
    const scope=selectedBusiness(await listYandexCampaigns(env));
    const reply=await yandexRequest(env,
     '/v2/businesses/'+scope.businessId+'/offer-mappings',
     {method:'POST',body:{offerIds:unique}});
    const safe=new Set(unique);
    for(const row of reply?.result?.offerMappings||[]){
     const offer=row?.offer;
     if(safe.has(offer?.offerId)&&typeof offer?.name==='string'&&
      offer.name.length>0&&offer.name.length<=200)
      catalogOfferNames[offer.offerId]=offer.name;
    }
   }catch{/* Missing owner catalog is not permission to guess cost. */}
  }
  const result=Object.keys(catalogOfferNames).length?
   reconcileDirectYandexMonth(month,base,realizations,costAudit,
    {catalogOfferNames}):firstPass;
  return json(200,result);
 }catch{
  return json(503,{code:'yandex_direct_cost_source_unavailable',
   month,netProfitKopecks:null});
 }
}
