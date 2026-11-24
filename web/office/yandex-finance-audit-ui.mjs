import {restoreYandexReportJobs} from './yandex-finance-job-cache.mjs';
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
export function renderYandexSourceAudit(doc,root,type,payload){
 if(!root||!EXPECTED.includes(type)||payload?.code!=='yandex_report_archive_audited'||
    payload.readOnly!==true||payload.changedRecords!==0||
    payload.financeProfitVerified!==false||!Array.isArray(payload.sheets))
  throw Error('yandex_audit_not_confirmed');
 const title={orders:'Заказы и товары',
  services:'Стоимость услуг Маркета',payments:'Платежи и взаимозачёты'}[type];
 const section=doc.createElement('section');section.className='profit-panel';
 textNode(doc,section,title+' · проверенный исходный архив','h4');
 for(const sheet of payload.sheets){
  const details=doc.createElement('details');
  const summary=doc.createElement('summary');
  summary.textContent=sheet.sheet+' · '+sheet.rows+' строк';
  details.append(summary);
  const shops=Array.isArray(sheet.shops)?sheet.shops:[];
  if(shops.length){
   textNode(doc,details,'Разбивка по магазинам одного ООО:');
   for(const shop of shops){
    const name=SHOPS[shop.partnerId];
    if(!name)continue;
    textNode(doc,details,name+' · '+shop.rows+' строк');
    for(const field of SELECT_FIELDS){
     const amount=shop.amounts?.[field];
     if(Number.isSafeInteger(amount))
      textNode(doc,details,field+': '+fmt(amount));
    }
   }
  }else textNode(doc,details,
   'Магазин не удалось надёжно определить по ID кампании или названию магазина. Распределение этих сумм заблокировано.');
  const evidence=sheet.shopIdentityEvidence;
  if(evidence&&typeof evidence==='object'&&sheet.rows>0){
   const used=evidence.present||{};
   textNode(doc,details,'Поля идентификации в исходном отчёте: '+
    ['partnerId','campaignId','shopName','businessId'].map(
      k=>k+' — '+(Number.isSafeInteger(used[k])?used[k]:0)
    ).join('; ')+'.');
   if(evidence.unmatchedRows>0){
    const sample=Object.entries(evidence.examples||{}).filter(
      ([k])=>['partnerId','campaignId','shopName'].includes(k));
    for(const [field,values]of sample)
     textNode(doc,details,'Неопознанные значения '+field+': '+
       (Array.isArray(values)?values.slice(0,3).join(', '):'нет'));
   }
  }
  if(typeof sheet.rows==='number'&&
     sheet.recognizedShopRows!==sheet.rows)
   textNode(doc,details,'Строк без подтверждённого магазина: '+
     (sheet.rows-(sheet.recognizedShopRows||0)));
  if(Array.isArray(sheet.skuCandidates)&&sheet.skuCandidates.length){
   const products=doc.createElement('details');
   const headline=doc.createElement('summary');
   headline.textContent='Товары и SKU для последующей сверки себестоимости · '+
     sheet.skuCandidates.length;
   products.append(headline);
   textNode(doc,products,'Количество строк не равно числу проданных единиц. '+
     'Финансовая себестоимость не назначена до подтверждения продажи и товара.');
   for(const item of sheet.skuCandidates){
    if(!SHOPS[item.partnerId]||typeof item.shopSku!=='string')continue;
    textNode(doc,products,SHOPS[item.partnerId]+' · '+item.shopSku+
      (item.offerName?' · '+item.offerName:'')+
      ' · строк: '+item.reportRows+
      ' · статусы: '+(item.statuses||[]).join(', '));
   }
   details.append(products);
  }
    for(const [dimension,part] of Object.entries(sheet.dimensions||{})){
   if(!['serviceName','service','recordType','transactionType',
    'model','placementModel','orderStatus'].includes(dimension))continue;
   const group=doc.createElement('details');
   const header=doc.createElement('summary');
   header.textContent='Группировка по '+dimension+' · '+
    (part.groups?.length||0)+' категорий';
   group.append(header);
   for(const entry of part.groups||[]){
    if(typeof entry.value!=='string')continue;
    textNode(doc,group,entry.value+' · '+entry.rows+' строк');
    for(const field of SELECT_FIELDS){
     const v=entry.amounts?.[field];
     if(Number.isSafeInteger(v))
      textNode(doc,group,'  '+field+': '+fmt(v));
    }
   }
   details.append(group);
  }
  section.append(details);
 }
 textNode(doc,section,'Это исходные суммы в разных экономических разрезах. '+
  'Суммы из разных листов, полей и отчётов НЕ складывать. '+
  'Чистая прибыль ООО не подтверждена.');
 root.append(section);
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
  try{
   for(const type of EXPECTED){
    try{
     const response=await fetcher('/api/yandex/report-audit?reportId='+
      encodeURIComponent(ids[type]),{method:'GET',credentials:'same-origin',
       cache:'no-store',signal:AbortSignal.timeout(30000)});
     if(!response.ok)throw Error('report_unavailable');
     const data=await response.json();
     renderYandexSourceAudit(documentRef,output,type,data);
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
    status.textContent='Перепроверены '+successes+' из 3 архивов. '+
     'Показаны суммы по магазинам и видам услуг. '+
     'Следующее условие для прибыли: исключить двойной учёт, сопоставить себестоимость по SKU и подтвердить возвраты.';
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
 // The other module discovers stores asynchronously and may replace the select;
 // the explicit button is always available if the first automatic attempt missed.
 onVisit();
 return true;
}
if(typeof document!=='undefined')attachYandexDetailedAudit();
