import {restoreYandexReportJobs,saveYandexReportJobs,mergeYandexRemoteJobs}
 from './yandex-finance-job-cache.mjs';
// Browser-side self-service runner. Every API call is owner-authenticated
// server-side. No API keys, customer rows or signed download URLs stored here.
// This runner cannot operate when the browser is closed: do not present it
// as a scheduled Worker or a completed accounting close.
const LAST='autosklad63.yandex.auto.last-request.v1';
const GAP_MS=130000; // official goods-realization: max one generation / 2 min
const INTERVAL=30000;
const TYPES=['orders','services','payments'];
const CAMPAIGNS=[149082506,149106500];
const safeMonth=/^20\d{2}-(0[1-9]|1[0-2])$/;
const key=(month,scope,type)=>month+':'+scope+':'+type;
export function isClosedYandexMonth(month,now=Date.now()){
 if(!safeMonth.test(month))return false;
 const [year,part]=month.split('-').map(Number);
 return Date.UTC(year,part,1)<=now;
}
export function classifyYandexReportStatus(report){
 if(report?.code!=='yandex_report_status'||
   !['PENDING','PROCESSING','FAILED','DONE'].includes(report.status))
  return {kind:'invalid'};
 if(['FAILED','DONE'].includes(report.status)&&
   report.subStatus==='NO_DATA'&&!report.fileAvailable)
  return {kind:'no_data'};
 if(report.status==='FAILED')
  return {kind:'failed',reason:report.subStatus||'UNKNOWN'};
 if(report.status==='DONE')
  return {kind:report.fileAvailable?'audit':'awaiting_file'};
 return {kind:'waiting'};
}
const counter=(sheet,field)=>{
 if(!sheet||!Number.isSafeInteger(sheet.rows))return null;
 if(sheet.rows===0)return 0;
 const v=sheet.quantityTotals?.[field];
 return v&&v.present===sheet.rows&&v.invalid===0&&
  Number.isSafeInteger(v.total)?v.total:null;
};
export function summarizedRealization(audit){
 if(audit?.code!=='yandex_report_archive_audited'||
  audit.readOnly!==true||!Array.isArray(audit.sheets))return null;
 const delivered=audit.sheets.find(s=>s.sheet==='delivered.json');
 const returned=audit.sheets.find(s=>s.sheet==='returned.json');
 return {delivered:counter(delivered,'deliveredCount'),
  returned:counter(returned,'returnedCount')};
}
export function attachYandexAutopilot({documentRef=document,fetcher=fetch,
 storage=window.localStorage,windowRef=window}={}){
 const container=documentRef.getElementById('yandexFinanceReports');
 const monthInput=documentRef.getElementById('ceoMonth');
 if(!container||!monthInput||!windowRef)return false;
 const panel=documentRef.createElement('section');
 panel.className='profit-panel';
 panel.id='yandexAutoReportsStatus';
 const h=documentRef.createElement('h4');
 h.textContent='Автоматическое обновление Яндекс Маркета';
 const state=documentRef.createElement('p');
 const details=documentRef.createElement('p');
 panel.append(h,state,details);container.prepend(panel);
 const summaries=new Map();
 let timer=null,busy=false,checkedCampaigns=false,lastMonth='',announcedMonth='',authBlocked=false;
 let fetchedRemoteMonth=null,serverWritable=true;
 const jobs=()=>restoreYandexReportJobs(storage);
 const save=(map)=>{
  saveYandexReportJobs(storage,map);
  windowRef.dispatchEvent(new Event('yandex-auto-jobs-updated'));
  if(!serverWritable)return;
  // Persist metadata only; no financial rows, customer information or token.
  void persistJobs(map);
 };
 const api=async(path,options)=>{
  const response=await fetcher(path,{credentials:'same-origin',cache:'no-store',
   signal:AbortSignal.timeout(30000),...options});
  const payload=await response.json();
  if(!response.ok)throw Error(payload.code||'api_unavailable');
  return payload;
 };
 const last=()=>{try{return Number(storage?.getItem(LAST)||0)||0;}
  catch{return 0;}};
 const stamp=()=>{try{storage?.setItem(LAST,String(Date.now()));}catch{}};
 async function persistJobs(map){
  try{
   for(const [jobKey,job] of map){
    const fields=jobKey.split(':');
    if(fields.length!==3)continue;
    const [month,scope,reportType]=fields;
    if(!['orders','services','payments','realization'].includes(reportType))
     continue;
    await api('/api/yandex/report-jobs',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({month,scope,reportType,
      reportId:job.reportId,status:job.status,createdAt:job.createdAt})});
   }
  }catch{serverWritable=false;}
 }
 async function loadRemoteJobs(month){
  if(fetchedRemoteMonth===month)return;
  // A failed server registry must not prevent local report generation.
  fetchedRemoteMonth=month;
  try{
   const response=await api('/api/yandex/report-jobs?month='+
    encodeURIComponent(month));
   if(response.code==='yandex_report_jobs_uninitialized'){
    const existing=jobs();
    if(existing.size&&serverWritable)void persistJobs(existing);
    return;
   }
   if(response.code!=='yandex_report_jobs_saved')return;
   const local=jobs();
   const combined=mergeYandexRemoteJobs(local,response.jobs||[]);
   if([...combined].some(([key,val])=>
     local.get(key)?.reportId!==val.reportId||
     local.get(key)?.status!==val.status)){
    saveYandexReportJobs(storage,combined);
    windowRef.dispatchEvent(new Event('yandex-auto-jobs-updated'));
   }
   const remoteKeys=new Map((response.jobs||[]).map(job=>
    [job.month+':'+job.scope+':'+job.reportType,job]));
   if(serverWritable&&[...combined].some(([key,job])=>{
    const stored=remoteKeys.get(key);
    return !stored||stored.reportId!==job.reportId||
     stored.createdAt<job.createdAt||
     (stored.status!==job.status&&job.status==='DONE');
   }))void persistJobs(combined);
  }catch{/* Local-only operation remains intact. */}
 }
 // Start while the office is open, not only after a finance-menu click.
 // Protected API endpoints still require an authenticated owner session.
 const active=()=>!authBlocked;
 const paint=(month,list,error='')=>{
  const ready=list.filter(x=>x.audited&&!x.noData).length;
  const noData=list.filter(x=>x.noData).length;
  state.textContent='Отчёты '+month+': обработано источников '+
   (ready+noData)+' из '+list.length+
   ' (проверенных архивов '+ready+', ответов NO_DATA '+noData+'). '+
   'NO_DATA означает отсутствие данных в конкретном отчёте, '+
   'а не доказательство нулевых продаж. '+
   'Обновляется автоматически при открытом офисе.'+
   (error?' Последнее отклонение: '+error+'.':'');
  const blocks=[];
  for(const campaign of CAMPAIGNS){
   const x=summaries.get(month+':'+campaign);
   const job=list[CAMPAIGNS.indexOf(campaign)+TYPES.length];
   const name=campaign===CAMPAIGNS[0]?'САД':'автосклад';
   if(job?.noData||x?.noData)blocks.push(name+
    ': Яндекс вернул NO_DATA; продажи и возвраты не подтверждены');
   else if(x)blocks.push(name+
    ': доставлено '+(x.delivered??'нет данных')+
    ', возвращено '+(x.returned??'нет данных'));
   else if(job?.status==='FAILED')blocks.push(name+
    ': отчёт не сформирован ('+(job.subStatus||'UNKNOWN')+')');
  }
  const both=CAMPAIGNS.map(x=>summaries.get(month+':'+x));
  if(both.every(x=>x&&Number.isSafeInteger(x.delivered)&&
    Number.isSafeInteger(x.returned))){
   blocks.unshift('ООО · по отчётам реализации: доставлено '+
    both.reduce((s,x)=>s+x.delivered,0)+', возвращено '+
    both.reduce((s,x)=>s+x.returned,0)+
    '. Количество не является себестоимостью или чистой прибылью');
  }
  details.textContent=blocks.join(' | ')||
   'Доставленные и возвращённые единицы подтянутся из двух отчётов реализации.';
 };
 let nextError='';
 async function tick(){
  if(busy||!active())return;
  const month=monthInput.value;
  if(!isClosedYandexMonth(month)){state.textContent='Период ещё не закрыт; отчёты не создаются.';return;}
  busy=true;
  try{
   if(lastMonth!==month){
    lastMonth=month;checkedCampaigns=false;
    serverWritable=true;
   }
   if(!checkedCampaigns){
    const result=await api('/api/yandex/finance-reports?action=discover');
    if(result.ownerConfirmedSingleOoo!==true||
     !CAMPAIGNS.every(id=>result.campaigns?.some(c=>c.campaignId===id)))
     throw Error('yandex_shops_not_verified');
    checkedCampaigns=true;
   }
   await loadRemoteJobs(month);
   const targets=[...TYPES.map(type=>({scope:'all',type})),
    ...CAMPAIGNS.map(campaignId=>({scope:String(campaignId),
      campaignId,type:'realization'}))];
   const map=jobs();
   // Inspect at most two jobs per tick. Official NO_DATA is a
   // distinguished outcome, not a zero-income or zero-units report.
   let examined=0,changed=false,cycleError='';
   for(const target of targets){
    const k=key(month,target.scope,target.type),job=map.get(k);
    if(!job||job.noData)continue;
    if(job.status==='FAILED'&&job.subStatus&&job.subStatus!=='NO_DATA')
     continue;
    if(job.status==='DONE'&&job.audited&&target.type!=='realization')
     continue;
    if(job.status==='DONE'&&job.audited&&
      summaries.has(month+':'+target.scope))continue;
    if(examined++>=2)break;
    const status=await api('/api/yandex/finance-reports?action=status&reportId='+
     encodeURIComponent(job.reportId));
    const decision=classifyYandexReportStatus(status);
    if(decision.kind==='invalid')throw Error('report_status_invalid');
    const subStatus=status.subStatus||
     (status.status==='FAILED'?'UNKNOWN':null);
    if(job.status!==status.status||job.subStatus!==subStatus){
     job.status=status.status;job.subStatus=subStatus;changed=true;
    }
    if(decision.kind==='no_data'){
     job.audited=true;job.noData=true;job.subStatus='NO_DATA';
     if(target.type==='realization')
      summaries.set(month+':'+target.scope,
       {noData:true,delivered:null,returned:null});
     changed=true;continue;
    }
    if(decision.kind==='failed'){
     cycleError='report_failed_'+decision.reason.toLowerCase();
     continue;
    }
    if(decision.kind==='awaiting_file'){
     cycleError='report_file_unavailable';continue;
    }
    if(decision.kind!=='audit')continue;
    const audit=await api('/api/yandex/report-audit?reportId='+
     encodeURIComponent(job.reportId));
    if(audit.code==='yandex_report_no_data'){
     job.audited=true;job.noData=true;job.subStatus='NO_DATA';
     if(target.type==='realization')
      summaries.set(month+':'+target.scope,
       {noData:true,delivered:null,returned:null});
     changed=true;continue;
    }
    if(audit.code==='report_not_ready'){
     cycleError='report_not_ready';continue;
    }
    if(audit.code!=='yandex_report_archive_audited')
     throw Error('report_archive_invalid');
    if(target.type==='realization')
     summaries.set(month+':'+target.scope,summarizedRealization(audit));
    if(!job.audited){job.audited=true;changed=true;}
   }
   if(changed)save(map);
   // The three archives can already be audited while the two realization
   // jobs are still pending. Do not re-download all three every 30 seconds.
   if(TYPES.every(type=>map.get(key(month,'all',type))?.audited)&&
     announcedMonth!==month){
    announcedMonth=month;
    windowRef.dispatchEvent(new Event('yandex-finance-ready'));
   }
   const missing=targets.find(x=>!map.has(key(month,x.scope,x.type)));
   if(missing&&Date.now()-last()>=GAP_MS){
    // Persist throttle before upstream request, even on 429/timeouts.
    stamp();
    const payload=await api('/api/yandex/finance-reports',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({month,reportType:missing.type,
      ...(missing.campaignId?{campaignId:missing.campaignId}:{})})});
    if(payload.code!=='yandex_report_requested'||
     !/^[a-zA-Z0-9_-]{1,255}$/.test(payload.reportId||''))
     throw Error('generation_response_invalid');
    map.set(key(month,missing.scope,missing.type),{
     reportId:payload.reportId,status:'PENDING',createdAt:Date.now(),
     audited:false});
    save(map);
   }
   nextError=cycleError;
   paint(month,targets.map(x=>map.get(key(month,x.scope,x.type))||{}),
    nextError);
  }catch(e){
   if(['unauthorized','forbidden','not_configured'].includes(e?.message))
    authBlocked=true;
   nextError=/^[a-z_]{3,80}$/.test(e?.message||'')?
    e.message:'source_temporarily_unavailable';
   const map=jobs();
   const targets=[...TYPES.map(type=>key(month,'all',type)),
    ...CAMPAIGNS.map(id=>key(month,id,'realization'))];
   paint(month,targets.map(k=>map.get(k)||{}),nextError);
  }finally{busy=false;}
 }
 const schedule=()=>{
  if(timer!==null)clearInterval(timer);
  timer=setInterval(()=>{void tick();},INTERVAL);
  void tick();
 };
 windowRef.addEventListener('hashchange',()=>{authBlocked=false;void tick();});
 monthInput.addEventListener('change',()=>{void tick();});
 schedule();
 return true;
}
if(typeof document!=='undefined')attachYandexAutopilot();
