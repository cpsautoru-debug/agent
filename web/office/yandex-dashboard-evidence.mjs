import {restoreYandexReportJobs} from './yandex-finance-job-cache.mjs';
import {buildYandexMonthlyEvidence} from './yandex-month-evidence.mjs';
import {yandexEvidenceAllowedForBusiness,excludedYandexIncome} from './legal-entity-scope.mjs';

// Shared read-only monthly Yandex evidence. Only verified source totals are
// retained in memory; never persist signed URLs, raw order rows or customers.
const TYPES=['orders','services','payments'];
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const CACHE_MS=5*60*1000;
const cache=new Map();
const pending=new Map();
const known=new Map();
const safeInt=x=>Number.isSafeInteger(x);

export function deriveYandexDashboardEvidence(month,sources){
 if(!yandexEvidenceAllowedForBusiness())return excludedYandexIncome(month);
 if(!MONTH.test(month)||!sources||typeof sources!=='object')
  return {month,status:'unavailable',incomeKopecks:null,
   netProfitKopecks:null,reason:'no_verified_sources'};
 for(const type of TYPES){
  const x=sources[type];
  if(x?.code!=='yandex_report_archive_audited'||x.readOnly!==true||
    x.changedRecords!==0||x.financeProfitVerified!==false||
    !Array.isArray(x.sheets))
   return {month,status:'unavailable',incomeKopecks:null,
    netProfitKopecks:null,reason:'source_'+type+'_not_audited'};
 }
 const result=buildYandexMonthlyEvidence(sources);
 const amount=result.preliminaryOrderAfterServiceKopecks;
 const rows=result.orderMargin?.rows;
 if(!safeInt(amount)||!safeInt(rows)||rows<=0)
  return {month,status:'unavailable',incomeKopecks:null,
   netProfitKopecks:null,reason:'order_margin_coverage_incomplete'};
 return {month,status:'order_income_verified',
  incomeKopecks:amount,orders:rows,
  includedServicesKopecks:result.orderMargin?.commission?.kopecks??null,
  serviceAuditComplete:!result.blocks.includes(
   'service_amount_coverage_incomplete'),
  paymentAuditComplete:!result.blocks.includes(
   'payment_coverage_incomplete'),
  blockers:result.blocks.filter(x=>x!=='sales_returns_and_sku_cogs_not_reconciled'),
  netProfitKopecks:null,
  evidence:'incomeWithoutServices from audited Yandex order-margin sheet; all 3 official reports read-only',
  meaning:'Доход по заказам после уже включённых услуг Яндекса. Не выручка до комиссий, не выплата и не чистая прибыль ООО.'};
}
export function rememberYandexDashboardEvidence(snapshot){
 if(!yandexEvidenceAllowedForBusiness())return false;
 if(!snapshot||!MONTH.test(snapshot.month)||
  snapshot.status!=='order_income_verified'||
  !safeInt(snapshot.incomeKopecks)||!safeInt(snapshot.orders)||
  snapshot.netProfitKopecks!==null)return false;
 known.set(snapshot.month,{...snapshot,checkedAt:Date.now()});
 return true;
}
export function lastYandexDashboardEvidence(month){
 if(!yandexEvidenceAllowedForBusiness())return null;
 const x=known.get(month);
 return x&&Date.now()-x.checkedAt<CACHE_MS?{...x}:null;
}
export async function loadYandexDashboardEvidence({
 month,fetcher=fetch,storage=typeof window!=='undefined'?
  window.localStorage:null,force=false}={}){
 if(!yandexEvidenceAllowedForBusiness())return excludedYandexIncome(month);
 if(!MONTH.test(month))return {month,status:'unavailable',incomeKopecks:null,
  netProfitKopecks:null,reason:'invalid_month'};
 const jobs=restoreYandexReportJobs(storage);
 const ids=TYPES.map(type=>{
  const job=jobs.get(month+':all:'+type);
  return job?.status==='DONE'&&job.audited===true&&job.noData!==true?
   job.reportId:null;
 });
 if(ids.some(id=>!id))
  return {month,status:'unavailable',incomeKopecks:null,
   netProfitKopecks:null,reason:'verified_report_ids_missing'};
 const k=month+':'+ids.join(':');
 const cached=cache.get(k);
 if(!force&&cached&&Date.now()-cached.time<CACHE_MS)
  return {...cached.value};
 if(pending.has(k))return pending.get(k);
 const work=(async()=>{
  try{
   const responses=await Promise.all(ids.map(id=>fetcher(
    '/api/yandex/report-audit?reportId='+encodeURIComponent(id),{
    method:'GET',credentials:'same-origin',cache:'no-store',
    signal:AbortSignal.timeout(30000),
    headers:{accept:'application/json'}})));
   if(responses.some(r=>!r.ok))
    return {month,status:'unavailable',incomeKopecks:null,
     netProfitKopecks:null,reason:'owner_source_unavailable'};
   const data=await Promise.all(responses.map(r=>r.json()));
   const source=Object.fromEntries(TYPES.map((type,i)=>[type,data[i]]));
   const evidence=deriveYandexDashboardEvidence(month,source);
   if(evidence.status==='order_income_verified'){
    rememberYandexDashboardEvidence(evidence);
    cache.set(k,{time:Date.now(),value:evidence});
   }
   return evidence;
  }catch{
   return {month,status:'unavailable',incomeKopecks:null,
    netProfitKopecks:null,reason:'archive_read_failed'};
  }finally{pending.delete(k);}
 })();
 pending.set(k,work);
 return work;
}
