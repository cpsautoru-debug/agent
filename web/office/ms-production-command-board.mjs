import {collectRecentProduction} from './ms-production-board-core.mjs';
import {formatMsMomentForSamara} from './ms-production-date.mjs';

// Manual management panel. Never claims all active production is known.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const run=el('msBoardRun'),stop=el('msBoardStop');
  const status=el('msBoardStatus'),stats=el('msBoardStats');
  const checked=el('msBoardChecked'),incomplete=el('msBoardIncomplete');
  const complete=el('msBoardComplete'),unknown=el('msBoardUnknown');
  const past=el('msBoardPast'),time=el('msBoardTime');
  const tbody=el('msBoardRows'),results=el('msBoardResults');
  const stagesSummary=el('msBoardStageSummary'),warehouseSummary=el('msBoardWarehouse');
  const toOrders=el('msBoardGoTasks'),toWarehouse=el('msBoardGoWarehouse');
  if([run,stop,status,stats,checked,incomplete,complete,unknown,past,time,
    tbody,results,stagesSummary,warehouseSummary,toOrders,toWarehouse].some(x=>!x))
    return;
  let running=false,stopped=false;
  const AUTO_INTERVAL_MS=30*60*1000;
  let lastAttempt=0;
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n);
  const now=()=>new Intl.DateTimeFormat('ru-RU',{
    timeZone:'Europe/Samara',dateStyle:'short',timeStyle:'short'
  }).format(new Date());
  const td=(tr,value)=>{
    const cell=document.createElement('td');
    cell.textContent=String(value);
    tr.append(cell);return cell;
  };
  const active=()=>!stopped&&document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const request=async path=>{
    const r=await fetch(path,{
      method:'GET',credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)
    });
    return {status:r.status,body:await r.json()};
  };
  function goTask(number){
    const field=el('msProductionNumber'),form=el('msProductionSearchForm');
    if(!field||!form)return;
    field.value=number;
    form.requestSubmit();
    el('msProductionMonitor')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  const labels={
    incomplete:'Не завершено',
    complete:'Учтённые этапы выполнены',
    unverified:'Не подтверждено'
  };
  const dates={
    past:'Плановая дата прошла',today:'Плановая дата сегодня',
    future:'Дата впереди',not_set:'Дата не указана',
    unverified:'Не подтверждено',not_applicable:'Не оценивается'
  };
  function render(board){
    const s=board.summary;
    stats.hidden=false;
    results.hidden=false;
    checked.textContent=fmt(s.checked)+' из '+fmt(10);
    incomplete.textContent=fmt(s.incomplete);
    complete.textContent=fmt(s.complete);
    unknown.textContent=fmt(s.unverified);
    past.textContent=fmt(s.planDatePast);
    time.textContent=now()+' · '+fmt(board.requests)+' GET';
    stagesSummary.textContent=s.firstIncompleteStages.length?
      'Первые незавершённые этапы в этой выборке: '+
      s.firstIncompleteStages.map(x=>x.name+' — '+fmt(x.tasks)).join('; ')+'.':
      'Первые незавершённые этапы среди проверенных не выявлены либо не подтверждены.';
    tbody.replaceChildren();
    for(const item of board.items){
      const tr=document.createElement('tr');
      td(tr,item.number);
      const cell=td(tr,labels[item.status]||labels.unverified);
      if(item.status==='unverified')cell.className='ms-board-unknown';
      td(tr,item.remaining===undefined?'Неизвестно':fmt(item.remaining));
      td(tr,item.firstUnfinishedStage||'—');
      const links=item.customerOrderLinks;
      td(tr,links?.status==='linked'?'Есть связь: '+fmt(links.count):
        links?.status==='none'?'Связи нет':'Не подтверждено');
      td(tr,item.plannedDate?formatMsMomentForSamara(item.plannedDate):'Не указана');
      const date=td(tr,dates[item.planDateStatus]||'Не подтверждено');
      if(item.planDateStatus==='past')date.className='ms-plan-date-past';
      const action=document.createElement('td');
      const btn=document.createElement('button');
      btn.type='button';btn.className='ms-production-detail-button';
      btn.textContent='Открыть №'+item.number;
      btn.addEventListener('click',()=>goTask(item.number));
      action.append(btn);tr.append(action);tbody.append(tr);
    }
    if(board.items.length===0){
      const tr=document.createElement('tr');
      const empty=td(tr,'В реестре нет заданий. Не приравнивайте это к отсутствию работы.');
      empty.colSpan=8;tbody.append(tr);
    }
    status.textContent='Автоматически проверено '+fmt(s.checked)+' недавно обновлённых документов из исторического реестра '+
      fmt(board.totalAllTime)+' · '+now()+' (Самара). '+
      'Среди них незавершённых '+fmt(s.incomplete)+
      ', завершённых '+fmt(s.complete)+
      ', неподтверждённых '+fmt(s.unverified)+
      '. Это НЕ полный перечень активных заказов, не сменная выработка и не фактическая отгрузка.';
  }
  const runScan=async()=>{
    if(running||!active())return;
    running=true;stopped=false;lastAttempt=Date.now();run.disabled=true;stop.disabled=false;
    stats.hidden=true;results.hidden=true;tbody.replaceChildren();
    time.textContent='Проверка запущена';
    status.textContent='Автоматически проверяем 10 недавно обновлённых документов и их этапы. Запросы последовательно, пауза 2 секунды.';
    try{
      const out=await collectRecentProduction({
        request,pause,active,nowMs:Date.now(),view:'updated',
        onProgress:p=>{
          status.textContent='Проверяем №'+p.number+' · '+p.checked+' из '+p.total+
            ' · выполнено '+p.requests+' запросов. При закрытии вкладки проверка остановится.';
        }
      });
      if(out.code==='ms_production_board_ok')render(out);
      else{
        stats.hidden=true;results.hidden=true;
        status.textContent='Сводка не подтверждена: '+out.reason+
          '. Проверка остановлена после '+fmt(out.requests)+
          ' GET. Данные не объявляются полными и не подставляются нулями. Можно пользоваться точным поиском по номеру.';
      }
    }catch{
      stats.hidden=true;results.hidden=true;
      status.textContent='Не удалось собрать подтверждённую сводку. Данные не изменялись.';
    }finally{running=false;run.disabled=false;stop.disabled=true;}
  };
  run.addEventListener('click',async()=>{await runScan();});
  const refreshIfNeeded=()=>{
    if(active()&&!running&&Date.now()-lastAttempt>=AUTO_INTERVAL_MS)
      void runScan();
  };
  window.addEventListener('hashchange',refreshIfNeeded);
  document.addEventListener('visibilitychange',refreshIfNeeded);
  window.setInterval(refreshIfNeeded,60*1000);
  refreshIfNeeded();
  stop.addEventListener('click',()=>{
    stopped=true;
    status.textContent='Остановка запрошена. Новых запросов после текущего не будет.';
    stop.disabled=true;
  });
  toOrders.addEventListener('click',()=>{
    el('msProductionMonitor')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
  toWarehouse.addEventListener('click',()=>{
    el('msInventoryControl')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
  window.addEventListener('ms:production-inventory-ready',event=>{
    const data=event.detail;
    if(!data||!Number.isSafeInteger(data.productionItems)||
      data.productionItems<0||!Number.isSafeInteger(data.lowMeterRows)||
      data.lowMeterRows<0||typeof data.complete!=='boolean')return;
    warehouseSummary.textContent='Учтено профильных складских позиций: '+
      fmt(data.productionItems)+'. Материалов с остатком меньше 40 м: '+
      fmt(data.lowMeterRows)+'. '+
      (data.complete?'Обход отчёта завершён.':'Отчёт ещё загружается.')+
      ' Коврики и прочие товары скрыты из производственного пульта.';
  });
  window.addEventListener('ms:warehouse-snapshot-ready',event=>{
    const d=event.detail;
    if(!d||typeof d.warehouseName!=='string'||
      !Number.isSafeInteger(d.positions)||d.positions<0||
      !Number.isSafeInteger(d.unverified)||d.unverified<0||
      d.unverified>d.positions||
      !Number.isSafeInteger(d.missingUnits)||d.missingUnits<0||
      d.missingUnits>d.positions)return;
    warehouseSummary.textContent=d.warehouseName+': '+fmt(d.positions)+
      ' ненулевых позиций · без подтверждённой категории '+fmt(d.unverified)+
      ' · единица измерения неизвестна у '+fmt(d.missingUnits)+
      '. Текущий снимок только одного склада, не общий баланс.';
  });
})();
