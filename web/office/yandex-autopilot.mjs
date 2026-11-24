import {restoreYandexReportJobs,saveYandexReportJobs}
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
const closed=month=>{
 if(!safeMonth.test(month))return false;
 const [year,part]=month.split('-').map(Number);
 return new Date(Date.UTC(year,part,1))<new Date();
};
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
 panel.append(h,state,details);container.append(panel);
 const summaries=new Map();
 let timer=null,busy=false,checkedCampaigns=false,lastMonth='',announcedMonth='';
 const jobs=()=>restoreYandexReportJobs(storage);
 const save=(map)=>{saveYandexReportJobs(storage,map);
  windowRef.dispatchEvent(new Event('yandex-auto-jobs-updated'));};
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
 const active=()=>windowRef.location.hash.split('/')[0]==='#yandexFinance';
 const paint=(month,list,error='')=>{
  const ready=list.filter(x=>x.audited).length;
  state.textContent='Отчёты '+month+': проверено '+ready+
   ' из '+list.length+'. Обновляется автоматически при открытом офисе.'+
   (error?' Последнее отклонение: '+error+'.':'');
  const blocks=[];
  for(const campaign of CAMPAIGNS){
   const x=summaries.get(month+':'+campaign);
   if(x)blocks.push((campaign===CAMPAIGNS[0]?'САД':'автосклад')+
    ': доставлено '+(x.delivered??'нет данных')+
    ', возвращено '+(x.returned??'нет данных'));
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
  if(!closed(month)){state.textContent='Период ещё не закрыт; отчёты не создаются.';return;}
  busy=true;
  try{
   if(lastMonth!==month){lastMonth=month;checkedCampaigns=false;}
   if(!checkedCampaigns){
    const result=await api('/api/yandex/finance-reports?action=discover');
    if(result.ownerConfirmedSingleOoo!==true||
     !CAMPAIGNS.every(id=>result.campaigns?.some(c=>c.campaignId===id)))
     throw Error('yandex_shops_not_verified');
    checkedCampaigns=true;
   }
   const targets=[...TYPES.map(type=>({scope:'all',type})),
    ...CAMPAIGNS.map(campaignId=>({scope:String(campaignId),
      campaignId,type:'realization'}))];
   const map=jobs();
   // Two independent status checks per tick keep upstream pressure bounded.
   let examined=0,changed=false;
   for(const target of targets){
    const k=key(month,target.scope,target.type),job=map.get(k);
    if(!job||job.status==='FAILED')continue;
    if(job.status==='DONE'&&job.audited&&target.type!=='realization')
     continue;
    if(job.status==='DONE'&&job.audited&&
      summaries.has(month+':'+target.scope))continue;
    if(examined++>=2)break;
    if(job.status!=='DONE'){
     const status=await api('/api/yandex/finance-reports?action=status&reportId='+
      encodeURIComponent(job.reportId));
     if(status.code!=='yandex_report_status')throw Error('status_invalid');
     if(job.status!==status.status){job.status=status.status;changed=true;}
    }
    if(job.status==='DONE'){
     const audit=await api('/api/yandex/report-audit?reportId='+
      encodeURIComponent(job.reportId));
     if(audit.code!=='yandex_report_archive_audited')
      throw Error('audit_incomplete');
     if(target.type==='realization')
      summaries.set(month+':'+target.scope,summarizedRealization(audit));
     if(!job.audited){job.audited=true;changed=true;}
    }
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
   nextError='';
   paint(month,targets.map(x=>map.get(key(month,x.scope,x.type))||{}));
  }catch(e){
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
 windowRef.addEventListener('hashchange',()=>{void tick();});
 monthInput.addEventListener('change',()=>{void tick();});
 schedule();
 return true;
}
if(typeof document!=='undefined')attachYandexAutopilot();
