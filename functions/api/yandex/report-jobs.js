import {json,verifyYandexOwner} from './finance-source.js';
// The owner-only server registry keeps opaque report IDs only, never reports,
// marketplace API keys, customer data or transient signed download URLs.
// Schema creation is idempotent and occurs on the first owner POST. The
// browser continues locally if D1 write access is unavailable.
const createSql=`CREATE TABLE IF NOT EXISTS yandex_finance_report_jobs (
 month TEXT NOT NULL CHECK (month GLOB '20[0-9][0-9]-[0-1][0-9]'),
 scope TEXT NOT NULL CHECK (scope = 'all' OR length(scope) BETWEEN 1 AND 15),
 report_type TEXT NOT NULL CHECK (report_type IN ('orders','services','payments','realization')),
 report_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','DONE','FAILED')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (month,scope,report_type)
) STRICT`;
const monthRule=/^20\d{2}-(0[1-9]|1[0-2])$/;
const idRule=/^[a-zA-Z0-9_-]{1,255}$/;
const campaignIds=new Set(['149082506','149106500']);
const reportTypes=new Set(['orders','services','payments','realization']);
const statuses=new Set(['PENDING','PROCESSING','DONE','FAILED']);
export function safeYandexJob(input,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).sort().join(',')!==
   'createdAt,month,reportId,reportType,scope,status')
  return null;
 if(!monthRule.test(input.month)||!idRule.test(input.reportId)||
    !reportTypes.has(input.reportType)||!statuses.has(input.status)||
    !Number.isSafeInteger(input.createdAt)||
    input.createdAt>now||now-input.createdAt>45*86400000)
  return null;
 if(input.reportType==='realization'?
    !campaignIds.has(input.scope):input.scope!=='all')return null;
 const [year,month]=input.month.split('-').map(Number);
 if(Date.UTC(year,month,1)>now)return null;
 return {month:input.month,scope:input.scope,reportType:input.reportType,
  reportId:input.reportId,status:input.status,
  createdAt:new Date(input.createdAt).toISOString()};
}
const unavailable=e=>({code:'report_registry_unavailable',
 detail:'Owner report IDs remain in local browser cache; no new report is required'});
export async function onRequestGet({request,env}){
 const url=new URL(request.url);
 if(request.method!=='GET'||url.pathname!=='/api/yandex/report-jobs'||
  url.hash||url.searchParams.size!==1||
  !monthRule.test(url.searchParams.get('month')||''))
  return json(400,{code:'invalid_scope'});
 const issue=await verifyYandexOwner(request,env);
 if(issue)return json(issue.status,{code:issue.code});
 try{
  const results=await env.OZON_FINANCE_DB.prepare(
   'SELECT month,scope,report_type,report_id,status,created_at FROM yandex_finance_report_jobs WHERE month=? LIMIT 20')
   .bind(url.searchParams.get('month')).all();
  const jobs=(results.results||[]).filter(r=>
   idRule.test(r.report_id)&&reportTypes.has(r.report_type)&&
   (r.report_type==='realization'?
    campaignIds.has(r.scope):r.scope==='all')&&
   statuses.has(r.status)&&!Number.isNaN(Date.parse(r.created_at)))
   .map(r=>({month:r.month,scope:r.scope,reportType:r.report_type,
    reportId:r.report_id,status:r.status,
    createdAt:Date.parse(r.created_at)}));
  return json(200,{code:'yandex_report_jobs_saved',readOnly:true,jobs,
   storedContent:'report_ids_and_metadata_only'});
 }catch{
  return json(200,{code:'yandex_report_jobs_uninitialized',
   readOnly:true,jobs:[],fallback:'local_browser_cache'});
 }
}
export async function onRequestPost({request,env}){
 const url=new URL(request.url);
 if(request.method!=='POST'||url.pathname!=='/api/yandex/report-jobs'||
  url.search||url.hash)
  return json(400,{code:'invalid_scope'});
 if(request.headers.get('Origin')!==url.origin||
    request.headers.get('Sec-Fetch-Site')==='cross-site')
  return json(403,{code:'origin_denied'});
 const issue=await verifyYandexOwner(request,env);
 if(issue)return json(issue.status,{code:issue.code});
 let body;
 try{
  const raw=await request.text();
  if(raw.length>2048)throw Error('too_large');
  body=JSON.parse(raw);
 }catch{return json(400,{code:'invalid_body'});}
 const job=safeYandexJob(body);
 if(!job)return json(400,{code:'invalid_report_job'});
 try{
  await env.OZON_FINANCE_DB.prepare(createSql).run();
  await env.OZON_FINANCE_DB.prepare(
   `INSERT INTO yandex_finance_report_jobs
     (month,scope,report_type,report_id,status,created_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(month,scope,report_type) DO UPDATE SET
      report_id=excluded.report_id,
      status=excluded.status,
      created_at=excluded.created_at,
      updated_at=CURRENT_TIMESTAMP
    WHERE excluded.created_at>=yandex_finance_report_jobs.created_at`)
   .bind(job.month,job.scope,job.reportType,job.reportId,job.status,
    job.createdAt).run();
  return json(200,{code:'yandex_report_job_persisted',
   changedRecords:1,storedContent:'report_id_only'});
 }catch{
  return json(503,unavailable());
 }
}
