(() => {
 'use strict';
 const get=id=>document.getElementById(id), form=get('wbImportPreviewForm');
 if(!form)return;
 const endpoint='/api/wb/saved-report';
 const validId=id=>/^\d{1,20}$/.test(id||'');
 const reportRows=get('wbSavedReportsRows');
 const button=get('wbSaveReportButton'), status=get('wbSavedReportStatus');
 if(!button||!status)return;
 let ownerAuthorized=false,previewReady=false,pending=false;
 const updateButton=()=>{button.disabled=!(ownerAuthorized&&previewReady)||pending;};
 updateButton();
 form.addEventListener('wb-preview-validated',event=>{previewReady=validId(event.detail?.reportId)&&event.detail.reportId===get('wbImportPreviewReportId')?.value?.trim();if(previewReady)ownerAuthorized=true;updateButton();});
 for(const field of ['wbSavedPeriodStart','wbSavedPeriodEnd'])get(field)?.addEventListener('change',()=>{previewReady=false;updateButton();});
 for(const event of ['input','change','reset'])form.addEventListener(event,()=>{previewReady=false;updateButton();});
 const rub=kop=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(kop/100);
 function display(value){
  const s=value?.snapshot,p=s?.preview,e=p?.estimate;
  if(value?.persisted!==true||value.storage!=='TEST_D1'||!validId(s?.reportId)||!e)throw Error('invalid_saved_report');
  status.textContent='Отчёт №'+s.reportId+' сохранён в тестовой базе. Период '+s.periodStart+' — '+s.periodEnd+'. Выплата по XLSX: '+rub(e.payoutKop)+'; себестоимость по справочнику: '+rub(e.cogsKop)+'; продажи: '+p.sales+'; возвраты: '+p.returns+'. Предварительная прибыль без восстановления возврата: '+rub(e.profitWithoutRestorationKop)+'.';
 }
 async function reload(){
  try{
   const r=await fetch(endpoint,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(r.status===404){ownerAuthorized=true;updateButton();status.textContent='Отчёт ещё не сохранён в тестовой базе.';return}
   if(!r.ok){status.textContent='Чтение сохранённого отчёта недоступно (HTTP '+r.status+'). После успешного расчёта можно отдельно запросить сохранение; сервер повторно проверит доступ.';return}
   const value=await r.json();
   if(value.snapshot)display(value);
   else {
    if(value.persisted!==true||value.storage!=='TEST_D1'||!Array.isArray(value.reports))throw Error('invalid_report_list');
    reportRows?.replaceChildren();
    for(const item of value.reports){
     if(!validId(item.reportId)||item.profitStatus!=='UNVERIFIED')throw Error('invalid_report_summary');
     const row=document.createElement('tr');
     for(const text of [item.reportId,item.periodStart+' — '+item.periodEnd,rub(item.payoutKop),rub(item.cogsKop),'XLSX сверен с контрольной выплатой; прибыль предварительная']){const cell=document.createElement('td');cell.textContent=text;row.appendChild(cell)}
     reportRows?.appendChild(row);
    }
    status.textContent='Сохранено отчётов за октябрь: '+value.reports.length+'. Периоды указаны владельцем; прибыль предварительная.';
   }
   ownerAuthorized=true;updateButton();
  }catch{status.textContent='Не удалось прочитать сохранённый отчёт. Повторных запросов нет.'}
 }
 button.addEventListener('click',async()=>{
  if(pending||!ownerAuthorized||!previewReady)return;
  const xlsx=get('wbImportPreviewXlsx')?.files?.[0],catalog=get('wbImportPreviewCatalog')?.files?.[0];
  const report=get('wbImportPreviewReportId')?.value?.trim();
  const payout=get('wbImportPreviewPayout')?.value?.trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  if(!validId(report)||!xlsx||!catalog||!/^\d+(?:\.\d{1,2})?$/.test(payout||'')){status.textContent='Выберите XLSX и JSON с одинаковым номером отчёта и укажите контрольную выплату.';return}
  const body=new FormData();
  body.append('reportId',report);body.append('expectedPayoutRub',payout);body.append('xlsx',xlsx);body.append('catalog',catalog);
  pending=true;button.disabled=true;
  status.textContent='Сервер повторно проверяет отчёт перед сохранением в тестовую базу…';
  try{
   const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'X-WB-Save-Report':'1','X-WB-Import-Preview':'1','X-WB-Period-Start':get('wbSavedPeriodStart')?.value||'','X-WB-Period-End':get('wbSavedPeriodEnd')?.value||''},body});
   if(r.status===409){status.textContent='Данные отличаются от уже сохранённого отчёта. Перезапись запрещена.';return}
   if(!r.ok){status.textContent='Отчёт не сохранён: проверка или доступ к тестовой базе не пройдены. Автоматического повтора нет.';return}
   display(await r.json());
   await reload();
  }catch{status.textContent='Результат сохранения неизвестен. Обновите страницу для чтения состояния; автоматического повтора нет.'}
  finally{pending=false;updateButton()}
 });
 void reload();
})();
