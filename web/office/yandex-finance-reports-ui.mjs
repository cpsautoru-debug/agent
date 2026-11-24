import {restoreYandexReportJobs,saveYandexReportJobs} from './yandex-finance-job-cache.mjs';
// Yandex Market reports are source evidence, NOT a verified P&L.
// Report generation uses Yandex's asynchronous job API; status is explicit.
export function attachYandexFinanceReports({documentRef=document,fetcher=fetch}={}){
 const root=documentRef.getElementById('yandexFinanceReports');
 const status=documentRef.getElementById('yandexFinanceReportsStatus');
 const scope=documentRef.getElementById('yandexFinanceCampaigns');
 const reportSelect=documentRef.getElementById('yandexFinanceReportType');
 const shopSelect=documentRef.getElementById('yandexFinanceShop');
 const generate=documentRef.getElementById('yandexFinanceGenerate');
 const generateAll=documentRef.getElementById('yandexFinanceAllReports');
 const jobSummary=documentRef.getElementById('yandexFinanceJobSummary');
 const check=documentRef.getElementById('yandexFinanceCheckStatus');
 const analyze=documentRef.getElementById('yandexFinanceAnalyze');
 const output=documentRef.getElementById('yandexFinanceReportLines');
 const monthInput=documentRef.getElementById('ceoMonth');
 if(!root||!status||!scope||!reportSelect||!shopSelect||!generate||
   !generateAll||!jobSummary||!check||
   !analyze||!output||!monthInput)return false;
 let storage=null;
 try{storage=window.localStorage;}catch{}
 const jobs=restoreYandexReportJobs(storage);
 let campaigns=null,loading=false,pollTimer=null,pollAttempts=0,batching=false;
 function remember(){saveYandexReportJobs(storage,jobs);renderJobs();}
 function renderJobs(){
  jobSummary.replaceChildren();
  const month=monthInput.value,scope=shopSelect.value;
  const names={orders:'Заказы и товары',services:'Услуги Маркета',
   payments:'Платежи'};
  for(const type of ['orders','services','payments']){
   const job=jobs.get(month+':'+scope+':'+type);
   const line=documentRef.createElement('p');
   line.textContent=names[type]+': '+(job?.status||'не запрошен')+
    (job?.audited?' · архив проверен':'');
   jobSummary.append(line);
  }
 }
 function stopPolling(){if(pollTimer!==null){clearTimeout(pollTimer);pollTimer=null;}}
 function schedulePolling(){
  stopPolling();
  const prefix=monthInput.value+':'+shopSelect.value+':';
  const pending=[...jobs].some(([key,v])=>key.startsWith(prefix)&&
   ['PENDING','PROCESSING'].includes(v.status));
  if(!pending||pollAttempts>=12)return;
  pollAttempts++;
  pollTimer=setTimeout(()=>{
   pollTimer=null;
   if(loading){schedulePolling();return;}
   void checkPendingJobs();
  },25000);
 }
 async function checkPendingJobs(){
  const prefix=monthInput.value+':'+shopSelect.value+':';
  const pending=[...jobs].filter(([key,v])=>key.startsWith(prefix)&&
   ['PENDING','PROCESSING'].includes(v.status));
  if(!pending.length||loading)return;
  loading=true;buttonState();
  let processed=0;
  try{
   for(const [key,job]of pending){
    try{
     const data=await request('/api/yandex/finance-reports?action=status&reportId='+
       encodeURIComponent(job.reportId));
     if(data.code!=='yandex_report_status')continue;
     job.status=data.status;
     if(data.status==='DONE'&&!job.audited){
      const audit=await request('/api/yandex/report-audit?reportId='+
       encodeURIComponent(job.reportId));
      if(audit.code==='yandex_report_archive_audited'&&
         Array.isArray(audit.sheets)){
       job.audited=true;processed++;
      }
     }
    }catch{/* Network or upstream throttling: retain the job for another check. */}
   }
   remember();
   say('Финансовые отчёты Яндекса: проверены статусы '+pending.length+
     ', архивов успешно разобрано '+processed+
     '. Финансовая прибыль не утверждается до сверки себестоимости и услуг.');
  }finally{loading=false;buttonState();schedulePolling();}
 }
 const names={orders:'Заказы и товары',
  services:'Стоимость услуг Маркета',payments:'Платежи и взаимозачёты'};
 const say=text=>{status.textContent=text;};
 const request=async(path,options)=>{
  const response=await fetcher(path,{
   credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),
   ...options});
  let data;try{data=await response.json();}catch{throw Error('invalid_response');}
  if(!response.ok)throw Error(data.code||'request_failed');
  return data;
 };
 const getKey=()=>monthInput.value+':'+shopSelect.value+':'+reportSelect.value;
 function getJob(){return jobs.get(getKey());}
 function buttonState(){
  generate.disabled=loading||batching||
   campaigns?.automaticScope!=='single_business'||!!getJob();
  generateAll.disabled=loading||batching||
   campaigns?.automaticScope!=='single_business';
  check.disabled=loading||!getJob();
  analyze.disabled=loading||!getJob()||getJob().status!=='DONE';
 }
 async function discover(){
  if(loading)return;
  loading=true;buttonState();say('Получаем кабинеты и магазины Яндекс Маркета…');
  try{
   const result=await request('/api/yandex/finance-reports?action=discover');
   if(result.code!=='yandex_campaigns_discovered'||
     !Array.isArray(result.businesses))throw Error('invalid_campaigns');
   campaigns=result;
   shopSelect.replaceChildren();
   const joint=documentRef.createElement('option');
   joint.value='all';joint.textContent='Оба магазина · одно ООО';
   shopSelect.append(joint);
   for(const shop of result.campaigns){
    const opt=documentRef.createElement('option');
    opt.value=String(shop.campaignId);
    opt.textContent=shop.shopName+' · '+shop.campaignId;
    shopSelect.append(opt);
   }
   shopSelect.disabled=result.automaticScope!=='single_business';
   scope.replaceChildren();
   const title=documentRef.createElement('p');
   title.textContent=result.businesses.length===1?
     'Кабинет: '+result.businesses[0].businessName+
     '; подключено магазинов: '+result.campaigns.length+'.':
     'Кабинетов: '+result.businesses.length+
     '. Для нескольких кабинетов требуется раздельное сопоставление юридических лиц.';
   scope.append(title);
   for(const shop of result.campaigns){
    const row=documentRef.createElement('p');
    row.textContent=shop.shopName+' · ID '+shop.campaignId+
      ' · '+shop.placementType;
    scope.append(row);
   }
   say(result.automaticScope==='single_business'?
     'Источники доступны. Можно запросить отчёт за выбранный месяц. Суммы появятся только после готовности и сверки.':
     'Автоматическая генерация для нескольких кабинетов заблокирована до раздельного выбора источников.');
  }catch(e){
   campaigns=null;
   say('Не удалось получить магазины: '+safeReason(e)+'.');
  }finally{loading=false;buttonState();renderJobs();schedulePolling();}
 }
 function safeReason(e){
  return /^[a-z_]{3,80}$/.test(e?.message||'')?e.message:'source_unavailable';
 }
 async function startReport(){
  if(loading||campaigns?.automaticScope!=='single_business'||getJob())return;
  loading=true;buttonState();
  const type=reportSelect.value,month=monthInput.value,
    shop=shopSelect.value;
  const campaignId=shop==='all'?undefined:Number(shop);
  say('Запрашиваем '+names[type]+' у Яндекса за '+month+'…');
  try{
   const data=await request('/api/yandex/finance-reports',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({month,reportType:type,
     ...(campaignId===undefined?{}:{campaignId})})
   });
   if(data.code!=='yandex_report_requested'||data.month!==month||
     data.reportType!==type||typeof data.reportId!=='string')
    throw Error('report_response_invalid');
   jobs.set(month+':'+shop+':'+type,{reportId:data.reportId,
    status:'PENDING',createdAt:Date.now()});
   remember();
   pollAttempts=0;schedulePolling();
   say('Отчёт «'+names[type]+'» принят Яндексом. Статус: формируется. '+
    'Проверяйте готовность без повторного запуска генерации.');
  }catch(e){say('Запрос отчёта не выполнен: '+safeReason(e)+
   '. Яндекс ограничивает частоту генерации — не повторяйте сразу.');}
  finally{loading=false;buttonState();}
 }
 async function startAllReports(){
  if(loading||batching||campaigns?.automaticScope!=='single_business')return;
  batching=true;
  const initial=reportSelect.value;
  try{
   let submitted=0,already=0;
   for(const type of ['orders','services','payments']){
    reportSelect.value=type;
    if(getJob()){already++;continue;}
    await startReport();
    if(getJob())submitted++;
    // Do not hammer report-generation API if a call was rejected.
    else break;
   }
   say('Финансовые отчёты Яндекса: новых заданий '+submitted+
    ', ранее созданных '+already+'. Статусы и ID сохранены в этом браузере. '+
    'Суммы отчётов не являются чистой прибылью.');
  }finally{
   reportSelect.value=initial;
   batching=false;buttonState();renderJobs();schedulePolling();
  }
 }
  async function checkStatus(){
  const key=getKey(),job=jobs.get(key);
  if(loading||!job)return;
  loading=true;buttonState();say('Проверяем готовность отчёта…');
  let auditReady=false;
  try{
   const data=await request('/api/yandex/finance-reports?action=status&reportId='+
    encodeURIComponent(job.reportId));
   if(data.code!=='yandex_report_status')throw Error('unexpected_status');
   job.status=data.status;remember();
   auditReady=data.status==='DONE'&&key===getKey();
   say(data.status==='DONE'?
     'Отчёт сформирован. Проверяем его исходные строки…':
     data.status==='FAILED'?
       'Яндекс отклонил генерацию: '+(data.subStatus||'FAILED')+'.':
       'Яндекс ещё формирует отчёт ('+data.status+').');
  }catch(e){say('Ошибка проверки отчёта: '+safeReason(e));}
  finally{
   loading=false;buttonState();
   if(auditReady)void analyzeReport();
   else if(key===getKey())schedulePolling();
  }
 }
 const rub=kopecks=>Number.isSafeInteger(kopecks)?
   new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'})
    .format(kopecks/100):'—';
 async function analyzeReport(){
  if(loading||getJob()?.status!=='DONE')return;
  loading=true;buttonState();say('Получаем архив и сверяем структуру и суммы полей…');
  output.replaceChildren();
  try{
   const data=await request('/api/yandex/report-audit?reportId='+
    encodeURIComponent(getJob().reportId));
   if(data.code!=='yandex_report_archive_audited'||
     data.financeProfitVerified!==false||!Array.isArray(data.sheets))
    throw Error('audit_result_invalid');
   const header=documentRef.createElement('p');
   header.textContent='Источник: '+names[reportSelect.value]+
    '; охват: '+shopSelect.options[shopSelect.selectedIndex]?.textContent+
    '. Листов: '+data.sheets.length+
    '. Это суммы отдельных полей, НЕ прибыль и не итоговая выручка.';
   output.append(header);
   for(const sheet of data.sheets){
    const detail=documentRef.createElement('details');
    const title=documentRef.createElement('summary');
    title.textContent=sheet.sheet+' · '+sheet.rows+' строк';
    detail.append(title);
    for(const [field,value] of Object.entries(sheet.sumFields||{})){
     if(!value.present)continue;
     const p=documentRef.createElement('p');
     p.textContent=field+': '+rub(value.totalKopecks)+
      ' ('+value.present+' строк; ошибок: '+value.invalid+')';
     detail.append(p);
    }
    for(const [kind,amount] of Object.entries(sheet.transactionTypes||{})){
     const p=documentRef.createElement('p');
     p.textContent='Транзакция '+kind+': '+rub(amount);
     detail.append(p);
    }
    output.append(detail);
   }
   say('Анализ архива выполнен. Колонки и суммы получены из API. '+
    'Для чистой прибыли необходима сверка между отчётами и подтверждение себестоимости.');
  }catch(e){
   say('Нельзя подтвердить содержимое отчёта: '+safeReason(e)+
    '. Непроверенные цифры не попадут в общую прибыль.');
  }finally{loading=false;buttonState();}
 }
 documentRef.getElementById('yandexFinanceDiscover')?.addEventListener('click',discover);
 generate.addEventListener('click',startReport);
 generateAll.addEventListener('click',startAllReports);
 check.addEventListener('click',checkStatus);
 analyze.addEventListener('click',analyzeReport);
 shopSelect.addEventListener('change',()=>{
  stopPolling();pollAttempts=0;buttonState();renderJobs();
  if(getJob()?.status==='PENDING'||getJob()?.status==='PROCESSING')
   schedulePolling();
 });
 reportSelect.addEventListener('change',()=>{
  stopPolling();pollAttempts=0;buttonState();
  if(getJob()?.status==='PENDING'||getJob()?.status==='PROCESSING')
   schedulePolling();
 });
 monthInput.addEventListener('change',()=>{
  stopPolling();pollAttempts=0;buttonState();renderJobs();
 });
 buttonState();renderJobs();
 const onVisit=()=>{
  if(location.hash.split('/')[0]==='#dashboard'&&!campaigns&&!loading)
   void discover();
 };
 window.addEventListener('hashchange',onVisit);
 onVisit();
 return true;
}
if(typeof document!=='undefined')attachYandexFinanceReports();
