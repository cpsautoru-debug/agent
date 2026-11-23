// User-triggered, owner-authorized exact October historical cost sync.
// Never call this write endpoint automatically on page load.
export function attachWbCostSync({documentRef=document,fetcher=fetch}={}){
 const button=documentRef.getElementById('wbCostSyncButton');
 const status=documentRef.getElementById('wbCostSyncStatus');
 if(!button||!status)return false;
 let busy=false;
 button.addEventListener('click',async()=>{
  if(busy)return;
  busy=true;button.disabled=true;
  status.textContent='Проверяем 35 подтверждённых себестоимостей и синхронизируем только октябрь 2026…';
  try{
   const r=await fetcher('/api/wb/cost-sync',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Accept':'application/json'},
    signal:AbortSignal.timeout(25000)
   });
   const data=await r.json();
   if(!r.ok||data.code!=='wb_cost_registry_synchronized'||
     data.month!=='2026-10'||data.confirmedArticles!==35||
     data.manufacturingCostKopecks!==39422300)
    throw Error('sync_not_confirmed');
   status.textContent='Себестоимость WB синхронизирована: '+
     data.confirmedArticles+' из 35 артикулов. Добавлено '+data.inserted+
     ', уже подтверждено '+data.alreadyConfirmed+
     '. Цены вне октября не изменялись. Обновляем расчёты…';
   documentRef.getElementById('wbProfitReload')?.click();
   documentRef.getElementById('wbCostCandidatesRefresh')?.click();
  }catch{
   status.textContent='Синхронизация не подтверждена: запись заблокирована или источник изменился. Октябрьский расчёт из сохранённых XLSX остаётся доступным. Никакие суммы прибыли не подменены.';
  }finally{busy=false;button.disabled=false;}
 });
 return true;
}
if(typeof document!=='undefined')attachWbCostSync();
