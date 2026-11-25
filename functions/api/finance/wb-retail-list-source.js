// Owner-session-only, read-only retail sales evidence from WB's official
// sales-reports/list. Gross retail amount is NOT certified AUSN tax revenue:
// returns, cashback, settlement dates and bank recognition remain separate.
const URL='https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list';
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const ID=/^\d{1,20}$/;
const cents=x=>{
 if(typeof x!=='string'||!/^-?\d+(?:\.\d{1,2})?$/.test(x))return null;
 const sign=x[0]==='-'?-1n:1n;
 const [a,b='']=(sign<0n?x.slice(1):x).split('.');
 const n=sign*(BigInt(a)*100n+BigInt(b.padEnd(2,'0')));
 return n>=-BigInt(Number.MAX_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER)?
  Number(n):null;
};
const simple=(status,extra={})=>({status,...extra,retailGrossKopecks:null,
 retailTaxScenarioKopecks:null,verifiedTaxBase:false});
export async function readWbRetailListSource(env,month,{fetcher=fetch}={}){
 if(!MONTH.test(month||'')||!env?.WB_REPORT_SNAPSHOT_DB||
    typeof env.WB_API_TOKEN!=='string'||!env.WB_API_TOKEN||
    /\s/.test(env.WB_API_TOKEN)||!env.WB_REPORT_ACCOUNT_ID)
  return simple('retail_source_unavailable');
 const start=month+'-01',next=new Date(start+'T00:00:00Z');
 next.setUTCMonth(next.getUTCMonth()+1);
 const end=next.toISOString().slice(0,10);
 const db=env.WB_REPORT_SNAPSHOT_DB;
 let expected;
 try{
  const result=await db.prepare(
   "SELECT report_id,report_type,date_from,date_to,bank_payment_kop,status "+
   "FROM wb_finance_api_reports WHERE account_id=? AND date_from>=? "+
   "AND date_to<? ORDER BY report_id LIMIT 201")
   .bind(env.WB_REPORT_ACCOUNT_ID,start,end).all();
  expected=result?.results;
 }catch{return simple('retail_saved_reports_unavailable');}
 if(!Array.isArray(expected)||!expected.length||expected.length>200||
    expected.some(x=>x.status!=='complete'||!ID.test(String(x.report_id))||
     !Number.isSafeInteger(x.bank_payment_kop)))
  return simple('retail_saved_report_coverage_incomplete',{
   savedReports:expected?.length??null});
 // Cache only already authenticated, strictly matched report-list summaries.
 // Neither a credential nor customer/order detail enters the cache.
 const key=new Request('https://autosklad63-office-staging.pages.dev/__private_wb_retail_cache/'+month);
 try{
  if(typeof caches!=='undefined'&&caches.default){
   const hit=await caches.default.match(key);
   if(hit){
    const cached=await hit.json();
    if(cached?.status==='report_retail_amounts_matched'&&
       cached.savedReports===expected.length&&
       cached.ids===expected.map(x=>String(x.report_id)).join(','))
     return {...cached,source:'WB_FINANCE_REPORT_LIST_CACHED'};
   }
  }
 }catch{}
 let response;
 try{
  response=await fetcher(URL,{method:'POST',redirect:'manual',
   signal:AbortSignal.timeout(16000),
   headers:{Authorization:env.WB_API_TOKEN,Accept:'application/json',
    'Content-Type':'application/json'},
   body:JSON.stringify({dateFrom:start,dateTo:end.slice(0,8)+
    String(Number(end.slice(8,10))-1).padStart(2,'0'),
    period:'weekly',limit:1000,offset:0})});
 }catch{return simple('retail_api_transport_error');}
 if(response.status!==200){
  await response.body?.cancel().catch(()=>{});
  return simple(response.status===429?'retail_api_rate_limited':
   response.status===401||response.status===403?
   'retail_api_auth_missing':'retail_api_unavailable');
 }
 let rows;
 try{
  const size=Number(response.headers.get('content-length'));
  if(Number.isFinite(size)&&size>700000)
   return simple('retail_list_too_large');
  const raw=await response.text();
  if(raw.length>700000)return simple('retail_list_too_large');
  rows=JSON.parse(raw);
 }catch{return simple('retail_list_invalid');}
 if(!Array.isArray(rows)||rows.length>=1000)
  return simple('retail_list_not_exhaustive');
 const reports=rows.filter(x=>typeof x?.dateFrom==='string'&&
  x.dateFrom>=start&&typeof x?.dateTo==='string'&&x.dateTo<end);
 if(reports.length!==expected.length)
  return simple('retail_list_report_count_mismatch',{
   savedReports:expected.length,reportedReports:reports.length});
 const map=new Map(expected.map(x=>[String(x.report_id),x]));
 const seen=new Set();let gross=0n;
 for(const x of reports){
  const id=String(x?.reportId??'');
  const old=map.get(id),amount=cents(x?.retailAmountSum),
   bank=cents(x?.bankPaymentSum);
  if(!old||seen.has(id)||x.currency!=='RUB'||
     Number(x.reportType)!==old.report_type||
     x.dateFrom!==old.date_from||x.dateTo!==old.date_to||
     !Number.isSafeInteger(amount)||!Number.isSafeInteger(bank)||
     bank!==old.bank_payment_kop)
   return simple('retail_list_identity_or_amount_mismatch',{
    savedReports:expected.length});
  seen.add(id);gross+=BigInt(amount);
 }
 if(gross<0n||gross>BigInt(Number.MAX_SAFE_INTEGER))
  return simple('retail_gross_invalid');
 const total=Number(gross);
 const tax=Number((gross*800n+5000n)/10000n);
 const result={status:'report_retail_amounts_matched',source:'WB_FINANCE_REPORT_LIST',
  period:month,savedReports:expected.length,
  ids:expected.map(x=>String(x.report_id)).join(','),
  retailGrossKopecks:total,retailTaxScenarioKopecks:tax,
  verifiedTaxBase:false,
  exclusions:['returns_and_cashback_reconciliation',
   'settlement_and_tax_recognition_dates','whole_ip_other_income'],
  note:'Retail sales report total is an API matched source indicator, NOT an official taxable base.'};
 try{
  if(typeof caches!=='undefined'&&caches.default){
   const cacheResponse=new Response(JSON.stringify(result),{
    headers:{'Content-Type':'application/json',
     'Cache-Control':'public, max-age=1800'}});
   await caches.default.put(key,cacheResponse);
  }
 }catch{}
 return result;
}