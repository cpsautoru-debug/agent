import {estimateProductionScanWorkload} from './ms-production-scan-budget.mjs';

// Explicit, owner-only API capability probe. No background polling, storage or scan.
(()=>{
  'use strict';
  const button=document.getElementById('msCoverageProbeStart');
  const status=document.getElementById('msCoverageProbeStatus');
  const summary=document.getElementById('msCoverageProbeSummary');
  if(!button||!status||!summary)return;
  let pending=false;
  const visible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const count=n=>new Intl.NumberFormat('ru-RU').format(n);
  button.addEventListener('click',async()=>{
    if(pending||!visible())return;
    pending=true;
    button.disabled=true;
    summary.hidden=true;
    summary.textContent='';
    status.textContent='Проверка возможностей API: два ограниченных чтения по одному образцу…';
    try{
      const response=await fetch('/api/ms/production-coverage-probe',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(30000)
      });
      const body=await response.json();
      if(!response.ok||body?.code!=='ms_production_coverage_probe_ok'||
        body.coverage!=='CAPABILITY_SAMPLE_ONLY_NO_FULL_SCAN'||
        body.allUnfinishedVerified!==false||
        !Number.isSafeInteger(body.totalTaskDocuments)||body.totalTaskDocuments<0||
        !Number.isSafeInteger(body.totalProductionStages)||body.totalProductionStages<0||
        !Number.isSafeInteger(body.estimatedTaskListPages50)||
        !Number.isSafeInteger(body.estimatedStageListPages50))
        throw Error(typeof body?.code==='string'?body.code:'invalid_probe_response');
      const plan=estimateProductionScanWorkload(body.totalTaskDocuments,body.totalProductionStages);
      const taskRef=body.sampleStageHasTaskReference==='observed'?
        'ссылка на задание в образце есть':'ссылка на задание в образце не обнаружена';
      const rowRef=body.sampleStageHasRowReference==='observed'?
        'ссылка на позицию есть':'ссылка на позицию не обнаружена';
      summary.textContent='Документов всего: '+count(body.totalTaskDocuments)+
        '; этапов всего: '+count(body.totalProductionStages)+
        '. Для чтения списков порциями по 50 понадобится как минимум '+
        count(body.estimatedTaskListPages50)+' страниц заданий и '+
        count(body.estimatedStageListPages50)+' страниц этапов. '+
        'Образец этапа: '+taskRef+', '+rowRef+'. '+
        'Оценка полного обхода: при подтверждённых связях — от '+
        count(plan.bulkCandidateRequests)+' запросов на первичный сбор списков ('+
        count(plan.bulkCandidateBatches)+' пакетов до 10 запросов); '+
        'при запросах этапов отдельно по каждому заданию — не меньше '+
        count(plan.perTaskMinimumRequests)+' запросов ('+
        count(plan.perTaskMinimumBatches)+' пакетов). '+
        'Рекомендуемый режим для будущего сканера: строго последовательно, '+
        'пауза не меньше 2 секунд между запросами, остановка на 429/ошибке. '+
        'Обе оценки без повторной сверки, связей и времени ответа. '+
        'Полнота связей и фактические незавершённые задания не проверены.';
      summary.hidden=false;
      status.textContent='Диагностика выполнена. Это оценка объёма API, не запуск массовой сверки.';
    }catch(error){
      status.textContent='Диагностика не завершена: '+
        String(error?.message||'request_failed').slice(0,80)+
        '. Данных о полном охвате нет, ничего не изменено.';
    }finally{
      pending=false;
      button.disabled=false;
    }
  });
})();
