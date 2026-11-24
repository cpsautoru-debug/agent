// Owner-authorized exact October historical cost sync.
// Auto-attempt once per page load using immutable versioned data from already
// owner-confirmed XLSX; the endpoint alone enforces owner authentication.
export function attachWbCostSync({documentRef=document,fetcher=fetch}={}){
 const button=documentRef.getElementById('wbCostSyncButton');
 const status=documentRef.getElementById('wbCostSyncStatus');
 if(!button||!status)return false;
 let busy=false;
 const sync=async()=>{
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
     data.manufacturingCostKopecks!==39422300){
    const knownStages=['sources','reconcile','plan','write','verify'];
    const knownReasons=[
     'database_operation_failed','wb_xlsx_source_invalid',
     'wb_xlsx_json_invalid','wb_xlsx_period_invalid','wb_xlsx_cost_not_confirmed',
     'wb_xlsx_cost_conflict','wb_october_coverage_incomplete',
     'wb_sync_source_unverified','wb_sync_cost_conflict',
     'wb_sync_older_history_conflict','wb_sync_existing_invalid',
     'wb_sync_existing_october_invalid','wb_sync_historical_version_conflict',
     'wb_sync_count_mismatch','database_write_forbidden',
     'database_constraint_rejected','database_batch_limit',
     'database_timeout','database_schema_mismatch',
     'wb_sync_postwrite_verification_failed'
    ];
    const stage=knownStages.includes(data.stage)?data.stage:'access';
    const reason=knownReasons.includes(data.reason)?data.reason:
      typeof data.code==='string'&&/^[a-z_]{3,60}$/.test(data.code)?
        data.code:'request_failed';
    status.textContent='Синхронизация не подтверждена. Этап: '+stage+
      '; причина: '+reason+'. Исторический P&L не изменён. '+
      'Эти сведения помогут точно определить блокировку записи.';
    return;
   }
   status.textContent='Себестоимость WB синхронизирована: '+
     data.confirmedArticles+' из 35 артикулов. Добавлено '+data.inserted+
     ', уже подтверждено '+data.alreadyConfirmed+
     '. Цены вне октября не изменялись. Обновляем расчёты…';
   documentRef.getElementById('wbProfitReload')?.click();
   documentRef.getElementById('wbCostCandidatesRefresh')?.click();
  }catch{
   status.textContent='Синхронизация не подтверждена: не удалось получить ответ от API. Сохранённый расчёт XLSX остаётся доступным.';
  }finally{busy=false;button.disabled=false;}
 };
 button.addEventListener('click',sync);
 // First read-only view of the office triggers one self-healing sync attempt.
 // A 401/403 or other error does not loop; owner can see the safe status.
 // This is one fixed-period write operation only, idempotent after success.
 if(typeof window!=='undefined'&&window.location.protocol==='https:')
  void sync();
 return true;
}
if(typeof document!=='undefined')attachWbCostSync();
