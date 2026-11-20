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
    status.textContent='Проверка возможностей API: не более двух ограниченных чтений…';
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
        body.totalProductionStages!==null||
        body.estimatedStageListPages50!==null||
        body.globalStageListAvailable!==false||
        !['ONE_PRODUCTION_TASK_FILTERED','NO_TASK_TO_SAMPLE'].includes(body.stageListScope)||
        (body.totalTaskDocuments===0?body.sampleTaskStageCount!==null:
          !Number.isSafeInteger(body.sampleTaskStageCount)||body.sampleTaskStageCount<0)||
        !Number.isSafeInteger(body.estimatedTaskListPages50))
        throw Error((typeof body?.code==='string'&&
          /^[a-z][a-z0-9_]{0,60}$/.test(body.code)?body.code:'invalid_probe_response')+
          (['productiontask','productionstage'].includes(body?.upstreamEntity)?
            ' · '+body.upstreamEntity:'')+
          (Number.isInteger(body?.upstreamHttp)&&
            body.upstreamHttp>=300&&body.upstreamHttp<=599?
            ' · HTTP '+body.upstreamHttp:''));
      const plan=estimateProductionScanWorkload(body.totalTaskDocuments,body.sampleTaskStageCount);
      const taskRef=body.sampleStageHasTaskReference==='observed'?
        'ссылка на задание в образце есть':'ссылка на задание в образце не обнаружена';
      const rowRef=body.sampleStageHasRowReference==='observed'?
        'ссылка на позицию есть':'ссылка на позицию не обнаружена';
      summary.textContent='Всего производственных заданий: '+count(body.totalTaskDocuments)+
        '. Общее количество этапов неизвестно: API требует фильтр по конкретному заданию. '+
        (body.sampleTaskStageCount===null?'Нет задания для выборочной проверки. ':
          'Этапов в одном выбранном задании: '+count(body.sampleTaskStageCount)+
          '. Образец этапа: '+taskRef+', '+rowRef+'. ')+
        'Минимальный обход: '+count(plan.taskPages)+' страниц реестра заданий по 50 и '+
        count(plan.perTaskMinimumRequests)+' запросов с проверкой этапов каждого задания ('+
        count(plan.perTaskMinimumBatches)+' пакетов до 10 запросов). '+
        'Это нижняя оценка: дополнительные страницы этапов, повторная сверка и время ответа не учтены. '+
        'Для будущего сканера: последовательные запросы, пауза не меньше 2 секунд, '+
        'остановка на 429 или ошибке. Полнота связей и фактические незавершённые задания не проверены.';
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
