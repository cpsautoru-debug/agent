(() => {
  'use strict';
  const button=document.getElementById('wbReportListButton');
  const status=document.getElementById('wbReportListStatus');
  const rows=document.getElementById('wbReportListRows');
  if (!button || !status || !rows) return;
  const endpoint='/api/wb/report-list';
  const key='wb-report-list-october-2026-v1';
  let attempted=false;
  try { attempted=sessionStorage.getItem(key)==='sent'; }
  catch { attempted=true; }
  if (attempted) {
    status.textContent='Проверка списка уже выполнялась в этой вкладке. Повторять запрос не нужно.';
    return;
  }
  fetch(endpoint,{credentials:'same-origin',cache:'no-store'}).then(async r=>{
    const data=r.ok?await r.json():null;
    if(data?.code==='owner_check_available') button.disabled=false;
    else status.textContent='Требуется вход владельца; запрос к WB не отправлялся.';
  }).catch(()=>{status.textContent='Проверка доступа недоступна; запрос к WB не отправлялся.';});
  button.addEventListener('click',async()=>{
    if (attempted) return;
    try { sessionStorage.setItem(key,'sent'); }
    catch { status.textContent='Нельзя отметить однократный запрос. WB не запрашивали.'; return; }
    attempted=true;
    button.disabled=true;
    status.textContent='Получаем список отчётов WB за октябрь 2026…';
    try {
      const response=await fetch(endpoint,{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-WB-Report-List':'october-2026'},
        body:'{}'
      });
      const result=await response.json();
      if(!response.ok || result.code!=='finance_report_list_received'){
        status.textContent='Запрос остановлен: '+(result.code||'unknown')+'; HTTP WB '+(result.upstreamHttp??'не получен')+'. Без повторов.';
        return;
      }
      status.textContent='WB HTTP 200. Всего отчётов: '+result.reportCount+
        '. Найдено известных октябрьских: '+result.knownCount+' из 10.'+
        (result.missing.length?' Нет в списке: '+result.missing.join(', ')+'.':' Все 10 найдены.')+
        ' Без записи в D1.';
      rows.replaceChildren();
      for (const report of result.reports) {
        const tr=document.createElement('tr');
        const text=[
          report.reportId,
          report.dateFrom+' — '+report.dateTo,
          report.reportType,
          report.bankPaymentRub===null?'—':report.bankPaymentRub+' ₽',
          report.bankPaymentMatchesReference===null?'Не сравнивалось':report.bankPaymentMatchesReference?'Совпадает':'Расхождение'
        ];
        for (const value of text) {
          const td=document.createElement('td');
          td.textContent=value;
          tr.appendChild(td);
        }
        rows.appendChild(tr);
      }
    } catch {
      status.textContent='Не удалось прочитать ответ. Повторный запрос не запускайте.';
    }
  });
})();