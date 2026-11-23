// Yandex Market reports are source evidence, NOT a verified P&L.
// Report generation uses Yandex's asynchronous job API; status is explicit.
export function attachYandexFinanceReports({documentRef=document,fetcher=fetch}={}){
 const root=documentRef.getElementById('yandexFinanceReports');
 const status=documentRef.getElementById('yandexFinanceReportsStatus');
 const scope=documentRef.getElementById('yandexFinanceCampaigns');
 const reportSelect=documentRef.getElementById('yandexFinanceReportType');
 const generate=documentRef.getElementById('yandexFinanceGenerate');
 const check=documentRef.getElementById('yandexFinanceCheckStatus');
 const analyze=documentRef.getElementById('yandexFinanceAnalyze');
 const output=documentRef.getElementById('yandexFinanceReportLines');
 const monthInput=documentRef.getElementById('ceoMonth');
 if(!root||!status||!scope||!reportSelect||!generate||!check||
   !analyze||!output||!monthInput)return false;
 const jobs=new Map();
 let campaigns=null,loading=false;
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
 const getKey=()=>monthInput.value+':'+reportSelect.value;
 function getJob(){return jobs.get(getKey());}
 function buttonState(){
  generate.disabled=loading||campaigns?.automaticScope!=='single_business';
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
  }finally{loading=false;buttonState();}
 }
 function safeReason(e){
  return /^[a-z_]{3,80}$/.test(e?.message||'')?e.message:'source_unavailable';
 }
 async function startReport(){
  if(loading||campaigns?.automaticScope!=='single_business')return;
  loading=true;buttonState();
  const type=reportSelect.value,month=monthInput.value;
  say('Запрашиваем '+names[type]+' у Яндекса за '+month+'…');
  try{
   const data=await request('/api/yandex/finance-reports',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({month,reportType:type})
   });
   if(data.code!=='yandex_report_requested'||data.month!==month||
     data.reportType!==type||typeof data.reportId!=='string')
    throw Error('report_response_invalid');
   jobs.set(month+':'+type,{reportId:data.reportId,status:'PENDING'});
   say('Отчёт «'+names[type]+'» принят Яндексом. Статус: формируется. '+
    'Проверяйте готовность без повторного запуска генерации.');
  }catch(e){say('Запрос отчёта не выполнен: '+safeReason(e)+
   '. Яндекс ограничивает частоту генерации — не повторяйте сразу.');}
  finally{loading=false;buttonState();}
 }
 async function checkStatus(){
  if(loading||!getJob())return;
  loading=true;buttonState();say('Проверяем готовность отчёта…');
  try{
   const data=await request('/api/yandex/finance-reports?action=status&reportId='+
    encodeURIComponent(getJob().reportId));
   if(data.code!=='yandex_report_status')throw Error('unexpected_status');
   getJob().status=data.status;
   say(data.status==='DONE'?
     'Отчёт сформирован. Можно проверить строки и агрегаты исходных данных.':
     data.status==='FAILED'?
       'Яндекс отклонил генерацию: '+(data.subStatus||'FAILED')+'.':
       'Яндекс ещё формирует отчёт ('+data.status+').');
  }catch(e){say('Ошибка проверки отчёта: '+safeReason(e));}
  finally{loading=false;buttonState();}
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
 check.addEventListener('click',checkStatus);
 analyze.addEventListener('click',analyzeReport);
 reportSelect.addEventListener('change',buttonState);
 monthInput.addEventListener('change',buttonState);
 buttonState();
 const onVisit=()=>{
  if(location.hash.split('/')[0]==='#dashboard'&&!campaigns&&!loading)
   void discover();
 };
 window.addEventListener('hashchange',onVisit);
 onVisit();
 return true;
}
if(typeof document!=='undefined')attachYandexFinanceReports();
