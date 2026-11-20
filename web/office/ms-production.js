import { formatMsMomentForSamara } from './ms-production-date.mjs';
(()=>{
  'use strict';
  const panel=document.getElementById('msProductionMonitor');
  const button=document.getElementById('msProductionRefresh');
  const status=document.getElementById('msProductionStatus');
  const count=document.getElementById('msProductionCount');
  const body=document.getElementById('msProductionRows');
  const details=document.getElementById('msProductionStagePanel');
  const stageTitle=document.getElementById('msProductionStageTitle');
  const stageStatus=document.getElementById('msProductionStageStatus');
  const planned=document.getElementById('msStagePlanned');
  const finished=document.getElementById('msStageFinished');
  const stageBody=document.getElementById('msProductionStageRows');
  if(!panel||!button||!status||!count||!body||!details||
    !stageTitle||!stageStatus||!planned||!finished||!stageBody)return;
  let loaded=false,loading=false,stageLoading=false;
  const setCell=(row,value)=>{
    const td=document.createElement('td');
    td.textContent=String(value);
    row.append(td);
    return td;
  };
  const quantity=value=>typeof value==='number'&&Number.isFinite(value)?
    new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(value):'—';
  async function loadStages(item){
    if(stageLoading||!item.id)return;
    stageLoading=true;
    details.hidden=false;
    stageTitle.textContent='Этапы задания №'+item.number;
    stageStatus.textContent='Получаем выполнение этапов из «МойСклад»…';
    planned.textContent='—';
    finished.textContent='—';
    stageBody.replaceChildren();
    try{
      const response=await fetch('/api/ms/production-stages?taskId='+encodeURIComponent(item.id),{
        method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
      });
      const payload=await response.json();
      if(!response.ok||payload.code!=='ms_production_stages_ok'||!Array.isArray(payload.stages)){
        const errorCode=typeof payload.code==='string'?payload.code:'http_'+response.status;
        const upstream=Number.isSafeInteger(payload.upstreamHttp)?' · HTTP '+payload.upstreamHttp:'';
        const apiCode=Number.isSafeInteger(payload.msErrorCode)?' · API '+payload.msErrorCode:'';
        throw new Error(errorCode+upstream+apiCode);
      }
      if(payload.stages.length===0){
        stageStatus.textContent='Для этого задания API не вернул ни одного этапа. План и факт не подтверждены.';
        return;
      }
      planned.textContent=quantity(payload.plan);
      finished.textContent=quantity(payload.finishedFinalStage);
      for(const stage of payload.stages){
        const tr=document.createElement('tr');
        setCell(tr,stage.name);
        setCell(tr,quantity(stage.plan));
        setCell(tr,quantity(stage.done));
        stageBody.append(tr);
      }
      stageStatus.textContent='Этапов: '+payload.stages.length+'. Данные по одному заданию, только чтение.';
    }catch(error){
      stageStatus.textContent='Этапы пока не получены: '+String(error.message||'unknown').slice(0,75)+
        '. Никаких изменений в «МойСклад» не было.';
    }finally{
      stageLoading=false;
    }
  }
  async function refresh(){
    if(loading)return;
    loading=true;button.disabled=true;
    status.textContent='Получаем последние задания из «МойСклад»…';
    try{
      const response=await fetch('/api/ms/production-feed',{
        method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
      });
      const payload=await response.json();
      if(!response.ok||payload.code!=='ms_production_feed_ok'||!Array.isArray(payload.records))
        throw new Error(payload.code||'http_'+response.status);
      body.replaceChildren();
      details.hidden=true;
      for(const item of payload.records){
        const tr=document.createElement('tr');
        setCell(tr,item.number??'—');
        const dateCell=setCell(tr,formatMsMomentForSamara(item.date));
        dateCell.title='API (МСК): '+String(item.date??'');
        const updateCell=setCell(tr,formatMsMomentForSamara(item.updated));
        updateCell.title='API (МСК): '+String(item.updated??'');
        const actionCell=document.createElement('td');
        const action=document.createElement('button');
        action.type='button';
        action.className='ms-production-detail-button';
        action.textContent=item.id?'Этапы и факт':'Недоступно';
        action.disabled=!item.id;
        if(item.id)action.addEventListener('click',()=>loadStages(item));
        actionCell.append(action);
        tr.append(actionCell);
        body.append(tr);
      }
      count.textContent='В «МойСклад» всего заданий за всё время: '+payload.totalAllTime+
        '. Показаны последние '+payload.records.length+' по дате документа.';
      status.textContent='Данные получены напрямую через API. Даты показаны по Самаре, только чтение.';
      loaded=true;
    }catch(error){
      status.textContent='Не удалось загрузить задания: '+String(error.message||'unknown').slice(0,70)+
        '. Если повторяется, сообщите код ошибки.';
    }finally{
      loading=false;button.disabled=false;
    }
  }
  button.addEventListener('click',refresh);
  const onNavigation=()=>{if(location.hash.split('/')[0]==='#production'&&!loaded&&!loading)refresh();};
  window.addEventListener('hashchange',onNavigation);
  onNavigation();
})();
