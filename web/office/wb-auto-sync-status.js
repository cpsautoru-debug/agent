(() => {
  'use strict';
  const button=document.getElementById('wbAutoSyncRefresh');
  const status=document.getElementById('wbAutoSyncStatus');
  const rows=document.getElementById('wbAutoSyncRows');
  if(!button||!status||!rows)return;
  const rub=kop=>new Intl.NumberFormat('ru-RU',{
    style:'currency',currency:'RUB'
  }).format(kop/100);
  let pending=false;
  async function refresh(){
    if(pending)return;
    pending=true;
    button.disabled=true;
    status.textContent='Читаем статус тестовой базы. Новых запросов к Wildberries нет…';
    try{
      const response=await fetch('/api/wb/auto-sync-status',{
        credentials:'same-origin',cache:'no-store'
      });
      if(!response.ok)throw Error('status_unavailable');
      const data=await response.json();
      if(data?.code!=='wb_api_sync_status'||data.source!=='WB_FINANCE_API'||
        !Array.isArray(data.reports))throw Error('invalid_status');
      status.textContent='Последний запуск: '+data.lastJobStatus+
        '; обновление: '+(data.lastStateChange||'не выполнялось')+
        '. Полных отчётов API: '+data.completedCount+' из '+data.reportCount+
        '. Выплата только по завершённым API-отчётам: '+rub(data.totalBankPaymentKop)+
        '. Себестоимость и чистая прибыль пока не рассчитываются автоматически. XLSX здесь не суммируются.';
      rows.replaceChildren();
      for(const report of data.reports){
        const tr=document.createElement('tr');
        for(const value of [
          report.reportId,report.dateFrom+' — '+report.dateTo,
          report.reportType===1?'Основной':'По выкупам',
          report.status,rub(report.bankPaymentKop),
          String(report.rowCount)
        ]){
          const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
        }
        rows.appendChild(tr);
      }
    }catch{
      status.textContent='Статус автоматической синхронизации пока недоступен. Сохранённые XLSX не изменены.';
    }finally{pending=false;button.disabled=false;}
  }
  button.addEventListener('click',refresh);
  refresh();
})();