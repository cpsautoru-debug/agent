(() => {
 'use strict';
 const get=id=>document.getElementById(id), form=get('wbImportPreviewForm');
 if(!form)return;
 const endpoint='/api/wb/saved-report', id='865265818';
 const panel=document.createElement('section'), heading=document.createElement('h3'), button=document.createElement('button'), status=document.createElement('p'), limits=document.createElement('p');
 heading.textContent='Сохранённый отчёт WB №865265818 · тестовая база';
 button.id='wbSaveReportButton';button.className='button primary';button.hidden=true;
 let ownerAuthorized=false,previewReady=false;
 const updateButton=()=>{button.hidden=!(ownerAuthorized&&previewReady);};
 form.addEventListener('wb-preview-validated',event=>{previewReady=event.detail?.reportId===id;updateButton();});
 for(const event of ['input','change','reset'])form.addEventListener(event,()=>{previewReady=false;updateButton();});
 button.type='button';button.textContent='Проверить и сохранить отчёт в тестовую базу';
 status.textContent='Проверяем наличие сохранённого отчёта…';
 limits.textContent='Источник — загруженный владельцем XLSX, не DEMO. Прибыль и налог предварительные (UNVERIFIED): API WB, налоговая база, возврат в запасы и дополнительные расходы не подтверждены. Сохранение не делает их окончательными.';
 for(const child of [heading,button,status,limits])panel.appendChild(child);
 form.parentElement.appendChild(panel);
 const rub=kop=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(kop/100);
 let pending=false;
 function display(value){
  const s=value?.snapshot,p=s?.preview,e=p?.estimate;
  if(value?.persisted!==true||value.storage!=='TEST_D1'||s?.reportId!==id||!e)throw Error('invalid_saved_report');
  status.textContent='Сохранено в тестовой базе. Период '+s.periodStart+' — '+s.periodEnd+'. Выплата по XLSX: '+rub(e.payoutKop)+'; себестоимость по справочнику: '+rub(e.cogsKop)+'; продажи: '+p.sales+'; возвраты: '+p.returns+'. Предварительная прибыль без восстановления возврата: '+rub(e.profitWithoutRestorationKop)+'.';
 }
 async function reload(){
  try{
   const r=await fetch(endpoint+'?reportId='+id,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(r.status===404){ownerAuthorized=true;updateButton();status.textContent='Отчёт ещё не сохранён в тестовой базе.';return}
   if(!r.ok){status.textContent='Сохранённый отчёт недоступен: требуется вход владельца и подключённая тестовая база.';return}
   display(await r.json());ownerAuthorized=true;updateButton();
  }catch{status.textContent='Не удалось прочитать сохранённый отчёт. Повторных запросов нет.'}
 }
 button.addEventListener('click',async()=>{
  if(pending||!ownerAuthorized||!previewReady)return;
  const xlsx=get('wbImportPreviewXlsx')?.files?.[0],catalog=get('wbImportPreviewCatalog')?.files?.[0];
  const report=get('wbImportPreviewReportId')?.value?.trim();
  const payout=get('wbImportPreviewPayout')?.value?.trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  if(report!==id||!xlsx||!catalog||!/^\d+(?:\.\d{1,2})?$/.test(payout||'')){status.textContent='Выберите XLSX и JSON для отчёта №865265818 и укажите контрольную выплату.';return}
  const body=new FormData();
  body.append('reportId',id);body.append('expectedPayoutRub',payout);body.append('xlsx',xlsx);body.append('catalog',catalog);
  pending=true;button.disabled=true;
  status.textContent='Сервер повторно проверяет отчёт перед сохранением в тестовую базу…';
  try{
   const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'X-WB-Save-Report':'1','X-WB-Import-Preview':'1'},body});
   if(r.status===409){status.textContent='Данные отличаются от уже сохранённого отчёта. Перезапись запрещена.';return}
   if(!r.ok){status.textContent='Отчёт не сохранён: проверка или доступ к тестовой базе не пройдены. Автоматического повтора нет.';return}
   display(await r.json());
  }catch{status.textContent='Результат сохранения неизвестен. Обновите страницу для чтения состояния; автоматического повтора нет.'}
  finally{pending=false;button.disabled=false}
 });
 void reload();
})();
