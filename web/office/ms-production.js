import { formatMsMomentForSamara } from './ms-production-date.mjs';

(()=>{
  'use strict';
  const node=id=>document.getElementById(id);
  const panel=node('msProductionMonitor');
  const refreshButton=node('msProductionRefresh');
  const status=node('msProductionStatus');
  const count=node('msProductionCount');
  const listBody=node('msProductionRows');
  const searchForm=node('msProductionSearchForm');
  const searchInput=node('msProductionNumber');
  const resetButton=node('msProductionReset');
  const previousButton=node('msProductionPrev');
  const nextButton=node('msProductionNext');
  const pageLabel=node('msProductionPage');
  const details=node('msProductionStagePanel');
  const stageTitle=node('msProductionStageTitle');
  const stageStatus=node('msProductionStageStatus');
  const stageRefresh=node('msProductionStageRefresh');
  const planned=node('msStagePlanned');
  const finished=node('msStageFinished');
  const remaining=node('msStageRemaining');
  const stageBody=node('msProductionStageRows');
  if(!panel||!refreshButton||!status||!count||!listBody||!searchForm||
    !searchInput||!resetButton||!previousButton||!nextButton||!pageLabel||
    !details||!stageTitle||!stageStatus||!stageRefresh||!planned||
    !finished||!remaining||!stageBody)return;

  const PAGE_SIZE=5;
  const REFRESH_MS=10*60*1000;
  let listLoading=false;
  let stageLoading=false;
  let scope={offset:0,number:null};
  let lastAttempt=0;
  let lastSuccess=0;
  let stageEpoch=0;
  let selectedTask=null;
  let records=[];

  const timeFormat=new Intl.DateTimeFormat('ru-RU',{
    timeZone:'Europe/Samara',day:'2-digit',month:'2-digit',
    year:'numeric',hour:'2-digit',minute:'2-digit'
  });
  const showTime=()=>timeFormat.format(new Date());
  const quantity=n=>typeof n==='number'&&Number.isFinite(n)?
    new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n):'—';
  const cell=(tr,text)=>{
    const td=document.createElement('td');
    td.textContent=String(text);
    tr.append(td);
    return td;
  };
  const isVisible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const scopeUrl=criteria=>{
    const search=new URLSearchParams();
    if(criteria.number!==null)search.set('number',criteria.number);
    else if(criteria.offset)search.set('offset',String(criteria.offset));
    const query=search.toString();
    return '/api/ms/production-feed'+(query?'?'+query:'');
  };
  const setLoading=loading=>{
    refreshButton.disabled=loading;
    previousButton.disabled=loading||scope.number!==null||scope.offset===0;
    nextButton.disabled=loading||scope.number!==null||
      !nextButton.dataset.hasMore||nextButton.dataset.hasMore!=='yes';
    resetButton.disabled=loading;
    searchForm.querySelector('button[type="submit"]').disabled=loading;
  };
  const clearSelectedTask=()=>{
    selectedTask=null;
    stageEpoch+=1;
    details.hidden=true;
    stageRefresh.disabled=true;
  };
  const showRecords=payload=>{
    listBody.replaceChildren();
    records=payload.records;
    clearSelectedTask();
    if(records.length===0){
      const tr=document.createElement('tr');
      const td=cell(tr,scope.number===null?'Заданий на этой странице нет.':'По этому номеру ничего не найдено.');
      td.colSpan=6;
      listBody.append(tr);
    }
    for(const item of records){
      const tr=document.createElement('tr');
      cell(tr,item.number??'—');
      const docDate=cell(tr,formatMsMomentForSamara(item.date));
      docDate.title='Время API (МСК): '+String(item.date??'');
      const deadline=cell(tr,item.plannedDate?formatMsMomentForSamara(item.plannedDate):'Не указана');
      deadline.title=item.plannedDate?'Плановая дата (Самара)':'Срок производства не назначен в «МойСклад»';
      cell(tr,item.documentPosted===true?'Проведён':
        item.documentPosted===false?'Не проведён':'—');
      const updated=cell(tr,formatMsMomentForSamara(item.updated));
      updated.title='Время API (МСК): '+String(item.updated??'');
      const actionCell=document.createElement('td');
      const button=document.createElement('button');
      button.type='button';
      button.className='ms-production-detail-button';
      button.textContent=item.id?'Этапы и факт':'Нет ID';
      button.disabled=!item.id;
      if(item.id)button.addEventListener('click',()=>loadStages(item));
      actionCell.append(button);
      tr.append(actionCell);
      listBody.append(tr);
    }
    if(payload.searchNumber!==null){
      count.textContent='По номеру '+payload.searchNumber+
        ': найдено документов — '+payload.totalMatching+'.';
      pageLabel.textContent='Точный поиск';
      previousButton.dataset.hasMore='no';
      nextButton.dataset.hasMore='no';
    }else{
      count.textContent='Всего документов в «МойСклад»: '+payload.totalAllTime+
        '. Показаны '+(payload.offset+1)+'–'+(payload.offset+records.length)+
        ' (не все активные задания).';
      pageLabel.textContent='Страница '+(Math.floor(payload.offset/PAGE_SIZE)+1);
      nextButton.dataset.hasMore=payload.hasMore?'yes':'no';
    }
    setLoading(false);
  };
  const validatedPayload=(payload,criteria)=>{
    if(payload?.code!=='ms_production_feed_ok'||
      !Array.isArray(payload.records)||payload.records.length>PAGE_SIZE||
      payload.offset!==criteria.offset||payload.searchNumber!==criteria.number||
      !Number.isSafeInteger(payload.pageSize)||payload.pageSize!==PAGE_SIZE)
      throw Error('invalid_production_feed');
  };

  async function refreshList(criteria=scope){
    if(listLoading)return;
    listLoading=true;
    lastAttempt=Date.now();
    setLoading(true);
    status.textContent='Загружаем производственные задания из «МойСклад»…';
    try{
      const response=await fetch(scopeUrl(criteria),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'}
      });
      const payload=await response.json();
      if(!response.ok)throw Error(payload?.code||'http_'+response.status);
      validatedPayload(payload,criteria);
      scope={...criteria};
      showRecords(payload);
      lastSuccess=Date.now();
      status.textContent='Обновлено '+showTime()+
        ' (Самара). Реальные данные API; только чтение.';
    }catch(error){
      status.textContent='Не удалось обновить: '+
        String(error.message||'unknown').slice(0,90)+
        '. Предыдущие данные, если есть, оставлены без изменений.';
    }finally{
      listLoading=false;
      setLoading(false);
    }
  }

  async function loadStages(item){
    if(stageLoading){
      stageStatus.textContent='Предыдущий запрос ещё выполняется. Повтори после его завершения.';
      return;
    }
    if(!item.id)return;
    stageLoading=true;
    selectedTask=item;
    const currentEpoch=++stageEpoch;
    details.hidden=false;
    stageRefresh.disabled=true;
    stageTitle.textContent='Этапы задания №'+item.number;
    stageStatus.textContent='Получаем выполнение этапов из «МойСклад»…';
    planned.textContent='—';
    finished.textContent='—';
    remaining.textContent='—';
    stageBody.replaceChildren();
    try{
      const response=await fetch('/api/ms/production-stages?taskId='+encodeURIComponent(item.id),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'}
      });
      const payload=await response.json();
      if(!response.ok||payload.code!=='ms_production_stages_ok'||!Array.isArray(payload.stages)){
        const errorCode=typeof payload.code==='string'?payload.code:'http_'+response.status;
        const upstream=Number.isSafeInteger(payload.upstreamHttp)?' · HTTP '+payload.upstreamHttp:'';
        const apiCode=Number.isSafeInteger(payload.msErrorCode)?' · API '+payload.msErrorCode:'';
        throw Error(errorCode+upstream+apiCode);
      }
      if(currentEpoch!==stageEpoch)return;
      if(payload.stages.length===0){
        stageStatus.textContent='Этапов нет: план/факт не подтверждён.';
        return;
      }
      planned.textContent=quantity(payload.plan);
      finished.textContent=quantity(payload.finishedFinalStage);
      remaining.textContent=quantity(Math.max(0,payload.plan-payload.finishedFinalStage));
      for(const stage of payload.stages){
        const tr=document.createElement('tr');
        cell(tr,stage.name);
        cell(tr,quantity(stage.plan));
        cell(tr,quantity(stage.done));
        const td=document.createElement('td');
        const progress=document.createElement('progress');
        progress.className='ms-stage-progress';
        progress.max=stage.plan>0?stage.plan:1;
        progress.value=stage.plan>0?Math.min(stage.done,stage.plan):0;
        const percent=stage.plan>0?
          Math.round(1000*stage.done/stage.plan)/10:
          (stage.done===0?100:0);
        progress.setAttribute('aria-label',
          stage.name+': '+quantity(stage.done)+' из '+quantity(stage.plan));
        const percentage=document.createElement('span');
        percentage.className='ms-stage-progress-value';
        percentage.textContent=quantity(percent)+'%';
        td.append(progress,percentage);
        tr.append(td);
        stageBody.append(tr);
      }
      stageStatus.textContent='Этапы обновлены '+showTime()+
        ' (Самара). Проверено только это задание.';
    }catch(error){
      if(currentEpoch===stageEpoch)stageStatus.textContent='Этапы пока не получены: '+
        String(error.message||'unknown').slice(0,90)+
        '. Данные «МойСклад» не изменялись.';
    }finally{
      stageLoading=false;
      stageRefresh.disabled=!selectedTask;
    }
  }

  searchForm.addEventListener('submit',event=>{
    event.preventDefault();
    const number=searchInput.value.trim();
    if(!/^\d{1,10}$/.test(number)){
      status.textContent='Укажи точный номер задания цифрами, например 00737.';
      return;
    }
    refreshList({offset:0,number});
  });
  resetButton.addEventListener('click',()=>{
    searchInput.value='';
    refreshList({offset:0,number:null});
  });
  previousButton.addEventListener('click',()=>{
    if(scope.number===null&&scope.offset>=PAGE_SIZE)
      refreshList({offset:scope.offset-PAGE_SIZE,number:null});
  });
  nextButton.addEventListener('click',()=>{
    if(scope.number===null&&nextButton.dataset.hasMore==='yes')
      refreshList({offset:scope.offset+PAGE_SIZE,number:null});
  });
  refreshButton.addEventListener('click',()=>refreshList());
  stageRefresh.addEventListener('click',()=>{if(selectedTask)loadStages(selectedTask);});

  const autoRefresh=()=>{
    if(isVisible()&&!listLoading&&Date.now()-lastAttempt>=REFRESH_MS)
      refreshList();
  };
  window.addEventListener('hashchange',autoRefresh);
  document.addEventListener('visibilitychange',autoRefresh);
  window.setInterval(autoRefresh,60*1000);
  autoRefresh();
})();
