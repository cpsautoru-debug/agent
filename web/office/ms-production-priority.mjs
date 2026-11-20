import {
  parsePriorityNumbers,collectPriorityProduction,buildPriorityCsv
} from './ms-production-priority-core.mjs';
import {formatMsMomentForSamara} from './ms-production-date.mjs';

// Temporary owner-entered worklist. Never writes to MoySklad or browser storage.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const form=el('msPriorityForm'),input=el('msPriorityNumbers');
  const stop=el('msPriorityStop'),status=el('msPriorityStatus');
  const summary=el('msPrioritySummary'),table=el('msPriorityTable');
  const tbody=el('msPriorityRows'),exportButton=el('msPriorityExport');
  if([form,input,stop,status,summary,table,tbody,exportButton].some(x=>!x))
    return;
  const submit=form.querySelector('button[type="submit"]');
  if(!submit)return;
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n);
  const labels={
    incomplete:'Есть незавершённые этапы',
    complete:'Учтённые этапы выполнены',
    unverified:'Не подтверждено'
  };
  const dates={
    past:'Плановая дата прошла',today:'Плановая дата сегодня',
    future:'Дата впереди',not_set:'Дата не указана',
    unverified:'Не подтверждено',not_applicable:'Не оценивается'
  };
  const td=(row,val)=>{
    const cell=document.createElement('td');
    cell.textContent=String(val);
    row.append(cell);return cell;
  };
  const active=()=>!cancelled&&document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const get=async path=>{
    const response=await fetch(path,{
      method:'GET',credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)
    });
    return {status:response.status,body:await response.json()};
  };
  let running=false,cancelled=false,last=null;
  function controls(){
    submit.disabled=running;
    input.disabled=running;
    stop.disabled=!running;
    exportButton.disabled=running||!last;
  }
  function goTask(number){
    const field=el('msProductionNumber'),taskForm=el('msProductionSearchForm');
    if(!field||!taskForm)return;
    field.value=number;
    taskForm.requestSubmit();
    el('msProductionMonitor')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function render(result){
    last=result;
    tbody.replaceChildren();
    const s=result.summary;
    summary.textContent='Проверено выбранных номеров: '+fmt(s.checked)+
      '. Незавершённых: '+fmt(s.incomplete)+
      ', учтённые этапы выполнены: '+fmt(s.complete)+
      ', не подтверждено: '+fmt(s.unverified)+
      ', прошла плановая дата: '+fmt(s.planDatePast)+'.';
    for(const item of result.items){
      const row=document.createElement('tr');
      td(row,item.number);
      const label=td(row,labels[item.status]||labels.unverified);
      if(item.status==='unverified')label.className='ms-board-unknown';
      td(row,typeof item.remaining==='number'?fmt(item.remaining):'Не подтверждено');
      td(row,item.firstUnfinishedStage||'—');
      td(row,item.plannedDate?formatMsMomentForSamara(item.plannedDate):'Не указана');
      const date=td(row,dates[item.planDateStatus]||'Не подтверждено');
      if(item.planDateStatus==='past')date.className='ms-plan-date-past';
      const action=document.createElement('td');
      const button=document.createElement('button');
      button.type='button';button.className='ms-production-detail-button';
      button.textContent='Открыть №'+item.number;
      button.addEventListener('click',()=>goTask(item.number));
      action.append(button);row.append(action);tbody.append(row);
    }
    table.hidden=false;
    status.textContent='Проверены только явно указанные номера · '+
      new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Samara',
        dateStyle:'short',timeStyle:'short'}).format(new Date())+
      ' (Самара), '+fmt(result.requests)+' последовательных GET. '+
      'Это не вся очередь заказов; дата производства не является договорным сроком клиента.';
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(running)return;
    let numbers;
    try{numbers=parsePriorityNumbers(input.value);}
    catch{
      status.textContent='Укажите от 1 до 5 разных номеров заданий «МойСклад» через запятую, пробел или новую строку.';
      return;
    }
    last=null;table.hidden=true;tbody.replaceChildren();
    summary.textContent='Сводка ещё не подтверждена.';
    cancelled=false;running=true;controls();
    status.textContent='Проверяем '+fmt(numbers.length)+
      ' выбранных заданий. Два чтения на номер, между запросами пауза 2 секунды.';
    try{
      const result=await collectPriorityProduction({
        numbers,request:get,pause,active,nowMs:Date.now(),
        onProgress:p=>{
          status.textContent='Проверено '+fmt(p.checked)+' из '+fmt(p.total)+
            ' · №'+p.number+' · '+fmt(p.requests)+' GET.';
        }
      });
      if(result.code==='ms_priority_production_ok')render(result);
      else{
        last=null;table.hidden=true;
        status.textContent='Проверка остановлена: '+result.reason+
          '. Результат неполный, никаких статусов не утверждаем. Выполнено '+
          fmt(result.requests)+' GET.';
      }
    }catch{
      last=null;table.hidden=true;
      status.textContent='Не удалось проверить выбранные задания. Документы не изменялись.';
    }finally{running=false;controls();}
  });
  stop.addEventListener('click',()=>{
    cancelled=true;
    stop.disabled=true;
    status.textContent='Остановка запрошена. После текущего запроса продолжения не будет.';
  });
  exportButton.addEventListener('click',()=>{
    if(!last||running)return;
    const csv=buildPriorityCsv(last.items);
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='autosklad63-production-selected-'+Date.now()+'.csv';
    document.body.append(link);
    link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='Список проверенных выбранных заданий выгружен локально. Это не импорт и не команда на пошив.';
  });
  controls();
})();
