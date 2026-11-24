import {restoreYandexReportJobs} from './yandex-finance-job-cache.mjs';
import {buildYandexMonthlyEvidence} from './yandex-month-evidence.mjs';
const MONTH='2026-10';
const EXPECTED=['orders','services','payments'];
const SHOPS={149082506:'Студия Авто Дизайна (САД)',
 149106500:'автосклад'};
const SELECT_FIELDS=['buyerPaid','servicePrice','fullPrice','paymentAmount',
 'transactionSum','buyerPaymentAmount','merchantPrice','sellPrice','billingPrice'];
const fmt=n=>Number.isSafeInteger(n)?
 new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):
 'Недостоверная сумма';
function textNode(doc,parent,value,tag='p'){
 const e=doc.createElement(tag);
 e.textContent=value;
 parent.append(e);return e;
}
export function collectYandexConfirmedJobs(storage,month=MONTH,shop='all'){
 const jobs=restoreYandexReportJobs(storage);
 const result={};
 for(const type of EXPECTED){
  const job=jobs.get(month+':'+shop+':'+type);
  if(job?.status==='DONE'&&job.audited&&typeof job.reportId==='string')
   result[type]=job.reportId;
 }
 return result;
}
export function renderYandexSourceAudit(doc,root,type,payload,selectedShop='unknown',month=MONTH){
 if(!root||!EXPECTED.includes(type)||
    payload?.code!=='yandex_report_archive_audited'||
    payload.readOnly!==true||payload.changedRecords!==0||
    payload.financeProfitVerified!==false||!Array.isArray(payload.sheets))
  throw Error('yandex_audit_not_confirmed');
 const title={orders:'Заказы и товары',
  services:'Стоимость услуг Маркета',payments:'Платежи и взаимозачёты'}[type];
 const section=doc.createElement('section');
 section.className='profit-panel';
 textNode(doc,section,title+' · '+month,'h4');
 let totalRows=0,assignedRows=0,unassignedRows=0;
 const money=(amount)=>fmt(amount);
 const approvedFields=type==='orders'?
  ['buyerPaymentAmount']:type==='services'?
   ['servicePrice']:['transactionSum'];
 const descriptions={
  buyerPaymentAmount:'Платёж покупателя (только заполненные строки)',
  servicePrice:'Начисленные услуги (по соответствующим листам)',
  transactionSum:'Сумма транзакций (не чистая прибыль)'
 };
 for(const sheet of payload.sheets){
  const count=Number.isSafeInteger(sheet.rows)?sheet.rows:0;
  const assigned=Number.isSafeInteger(sheet.recognizedShopRows)?
   sheet.recognizedShopRows:0;
  totalRows+=count;assignedRows+=assigned;unassignedRows+=count-assigned;
  const summary=doc.createElement('div');
  summary.className='yandex-brief-sheet';
  textNode(doc,summary,sheet.sheet+' · '+count+' строк','h5');
  if(count>0)textNode(doc,summary,
   assigned===count?'Распределение по магазинам: '+assigned+' из '+count:
    'Известен результат всего ИП. По магазинам распознано '+
    assigned+' из '+count+' строк.');
  for(const field of approvedFields){
   const value=sheet.sumFields?.[field];
   if(!value?.present||value.invalid||
     !Number.isSafeInteger(value.totalKopecks))continue;
   textNode(doc,summary,descriptions[field]+': '+money(value.totalKopecks)+
    ' · '+value.present+' строк');
  }
  if(type==='orders'&&sheet.sumFields?.billingPrice?.present)
   textNode(doc,summary,'Цена продажи за штуку (billingPrice) — '+
    'не является суммарной выручкой. Для суммы нужны подтверждённые количества.');
  const shops=Array.isArray(sheet.shops)?sheet.shops:[];
  if(shops.length){
   const known=doc.createElement('details');
   const label=doc.createElement('summary');
   label.textContent='Суммы по подтверждённым магазинам';known.append(label);
   for(const shop of shops){
    if(!SHOPS[shop.partnerId])continue;
    textNode(doc,known,SHOPS[shop.partnerId]+' · '+shop.rows+' строк');
    for(const field of approvedFields){
     const amount=shop.amounts?.[field];
     if(Number.isSafeInteger(amount))
      textNode(doc,known,descriptions[field]+': '+money(amount));
    }
   }
   summary.append(known);
  }
  const technical=doc.createElement('details');
  const technicalTitle=doc.createElement('summary');
  technicalTitle.textContent='Расшифровка, товары и технические сведения';
  technical.append(technicalTitle);
  const evidence=sheet.shopIdentityEvidence||{};
  textNode(doc,technical,'Привязка: '+assigned+' из '+count+
   '. ID полей: '+['partnerId','campaignId','shopName','partnerName','businessId']
    .map(k=>k+': '+(evidence.present?.[k]||0)).join('; '));
  for(const field of ['partnerId','shopName','partnerName','businessId']){
   const samples=evidence.examples?.[field];
   if(Array.isArray(samples)&&samples.length)
    textNode(doc,technical,field+': '+samples.slice(0,3).join(', '));
  }
  if(Array.isArray(sheet.skuCandidates)&&sheet.skuCandidates.length){
   const productBlock=doc.createElement('details');
   const heading=doc.createElement('summary');
   heading.textContent='Товары и SKU · '+sheet.skuCandidates.length;
   productBlock.append(heading);
   textNode(doc,productBlock,'Строки операций не равны продажам; '+
    'себестоимость отдельно подтверждается по количеству и SKU.');
   for(const item of sheet.skuCandidates){
    if(!SHOPS[item.partnerId]||typeof item.shopSku!=='string')continue;
    textNode(doc,productBlock,SHOPS[item.partnerId]+' · '+item.shopSku+
     (item.offerName?' · '+item.offerName:'')+
     ' · строк '+item.reportRows+
     (item.quantityRows?' · количество по строкам '+item.reportedQuantity+
      ' ('+item.quantityRows+' строк)':'')+
     (item.quantityInvalidRows?' · ошибок количества '+item.quantityInvalidRows:'')+
     (item.statuses?.length?' · статусы '+item.statuses.join(', '):''));
   }
   technical.append(productBlock);
  }
  for(const [dimension,part]of Object.entries(sheet.dimensions||{})){
   if(!['serviceName','service','recordType','transactionType',
    'model','placementModel','orderStatus'].includes(dimension))continue;
   const group=doc.createElement('details');
   const header=doc.createElement('summary');
   header.textContent='Операции по '+dimension+
    ' · '+(part.groups?.length||0)+' групп';
   group.append(header);
   for(const entry of part.groups||[]){
    if(typeof entry.value!=='string')continue;
    textNode(doc,group,entry.value+' · '+entry.rows+' строк');
    for(const field of approvedFields){
     const amount=entry.amounts?.[field];
     if(Number.isSafeInteger(amount))
      textNode(doc,group,descriptions[field]+': '+money(amount));
    }
   }
   technical.append(group);
  }
  summary.append(technical);section.append(summary);
 }
 textNode(doc,section,'Проверено строк: '+totalRows+
  '. Отнесено к магазинам: '+assignedRows+
  '. Без магазинной детализации: '+unassignedRows+'.');
 textNode(doc,section,'Показатели разных отчётов и листов нельзя '+
  'суммировать друг с другом. До сверки продаж, возвратов, '+
  'себестоимости и прямых расходов чистая прибыль ИП не подтверждена.');
 root.append(section);
}
export function renderYandexMonthlyEvidence(doc,root,sourceEvidence){
 const data=buildYandexMonthlyEvidence(sourceEvidence);
 const wrapper=doc.createElement('section');
 wrapper.className='profit-panel yandex-accounting-summary';
 textNode(doc,wrapper,'Яндекс Маркет · финансовый результат ИП','h3');
 const margin=data.orderMargin;
 if(Number.isSafeInteger(data.preliminaryOrderAfterServiceKopecks)){
  textNode(doc,wrapper,
   'Доход по заказам после услуг, уже включённых в отчёт: '+
    fmt(data.preliminaryOrderAfterServiceKopecks),'h4');
  textNode(doc,wrapper,'Промежуточная сумма из '+margin.rows+
    ' заказов, а не чистая прибыль. Себестоимость, отдельные услуги, '+
    'возвраты и налоги ещё не выверены.');
 }else if(margin?.income){
  textNode(doc,wrapper,'Доход после услуг по заполненным строкам: '+
   fmt(margin.income.kopecks)+
   '. Нельзя утверждать общую сумму: строк '+margin.income.rows+
   ' из '+margin.rows+', повторов заказов: '+
   (margin.duplicates??'не определены')+'.');
 }else textNode(doc,wrapper,
  'Доход после услуг: не подтверждён — поле incomeWithoutServices отсутствует или отчёт неполный.');
 if(margin?.commission?.rows)
  textNode(doc,wrapper,'Услуги в составе расчёта заказов: '+
   fmt(margin.commission.kopecks)+
   ' (уже учтены в доходе после услуг — второй раз не вычитать).');
 const services=data.services;
 if(services?.rows){
  const verified=services.sheets.filter(x=>x.amount&&
   x.amount.rows===x.rows&&x.amount.invalid===0);
  const amount=verified.reduce((sum,x)=>sum+x.amount.kopecks,0);
  textNode(doc,wrapper,'Отдельный отчёт услуг: '+
   verified.length+' из '+services.sheets.length+
   ' статей с подтверждёнными числовыми полями; сумма этих статей '+
   fmt(amount)+'. Не вычитается повторно без сверки с заказами.');
 }
 if(data.payments?.amount)
  textNode(doc,wrapper,'Платёжный реестр: '+
   fmt(data.payments.amount.kopecks)+
   ' (контрольная сумма транзакций, не выручка и не прибыль).');
 textNode(doc,wrapper,
  'Чистая прибыль ИП: НЕ ПОДТВЕРЖДЕНА. '+
  'Осталось сверить фактические продажи и возвраты по SKU, '+
  'себестоимость, внешние расходы и налог ИП.');
 root.prepend(wrapper);
 return data;
}
export function attachYandexDetailedAudit({documentRef=document,fetcher=fetch,
 storage=window.localStorage}={}){
 const button=documentRef.getElementById('yandexFinanceAnalyzeAll');
 const status=documentRef.getElementById('yandexFinanceDetailedStatus');
 const output=documentRef.getElementById('yandexFinanceDetailedResults');
 const month=documentRef.getElementById('ceoMonth');
 const shop=documentRef.getElementById('yandexFinanceShop');
 if(!button||!status||!output||!month||!shop)return false;
 let running=false,wasLoaded=false;
 async function run(){
  if(running)return;
  const selectedMonth=month.value,selectedShop=shop.value;
  const ids=collectYandexConfirmedJobs(storage,selectedMonth,selectedShop);
  if(Object.keys(ids).length!==3){
   status.textContent='Для общей расшифровки необходимы все 3 отчёта со статусом DONE и проверенным архивом. Повторно генерировать их не нужно.';
   return;
  }
  running=true;button.disabled=true;output.replaceChildren();
  let successes=0;
  const auditedSources={};
  try{
   for(const type of EXPECTED){
    try{
     const response=await fetcher('/api/yandex/report-audit?reportId='+
      encodeURIComponent(ids[type]),{method:'GET',credentials:'same-origin',
       cache:'no-store',signal:AbortSignal.timeout(30000)});
     if(!response.ok)throw Error('report_unavailable');
     const data=await response.json();
     renderYandexSourceAudit(documentRef,output,type,data,selectedShop,selectedMonth);
     auditedSources[type]=data;
     successes++;
    }catch{
     textNode(documentRef,output,
      'Не удалось перепроверить источник «'+type+
      '». Неполные суммы не выдаются за прибыль.');
    }
   }
   if(month.value!==selectedMonth||shop.value!==selectedShop){
    output.replaceChildren();
    status.textContent='Месяц или магазин изменён; данные прежней выборки скрыты.';
   }else{
    renderYandexMonthlyEvidence(documentRef,output,auditedSources);
    // Reuse already audited summaries for SKU cost/contribution calculations.
    // No additional three-archive downloads and no persistence of source rows.
    if(successes===3&&selectedShop==='all'&&
       EXPECTED.every(type=>auditedSources[type]?.readOnly===true&&
        auditedSources[type]?.changedRecords===0&&
        auditedSources[type]?.financeProfitVerified===false))
     window.dispatchEvent(new CustomEvent('yandex-financial-sources-audited',{
      detail:{month:selectedMonth,sources:auditedSources}}));
    status.textContent='Финансовые источники: '+successes+' из 3 архивов. '+
     'Выведен промежуточный результат заказов (при достаточном покрытии); '+
     'чистая прибыль не подтверждается до сверки себестоимости и возвратов.';
   }
  }finally{running=false;button.disabled=false;}
 }
 button.addEventListener('click',()=>{void run();});
 const onVisit=()=>{
  if(location.hash.split('/')[0]==='#yandexFinance'&&!wasLoaded&&
    Object.keys(collectYandexConfirmedJobs(storage,month.value,shop.value)).length===3){
   wasLoaded=true;void run();
  }
 };
 window.addEventListener('hashchange',onVisit);
 window.addEventListener('yandex-finance-ready',()=>{
  if(!running){wasLoaded=false;onVisit();}
 });
 month.addEventListener('change',()=>{wasLoaded=false;onVisit();});
 shop.addEventListener('change',()=>{wasLoaded=false;onVisit();});
 // The other module discovers stores asynchronously and may replace the select;
 // the explicit button is always available if the first automatic attempt missed.
 onVisit();
 return true;
}
if(typeof document!=='undefined')attachYandexDetailedAudit();
