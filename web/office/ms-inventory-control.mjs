import {
  checkInventoryPage,inventoryRows,summarizeInventory,unitTotals
} from './ms-inventory-control-view.mjs';

// Only owner-protected, read-only /api/ms/stock-bystore. The existing API
// makes a bounded report + assortment name read; no warehouse writes, D1 writes,
// secret access, or production status guesses. Report pages are non-atomic.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const root=el('msInventoryControl'),runButton=el('msInventoryReload'),
    pauseButton=el('msInventoryPause'),continueButton=el('msInventoryContinue'),
    status=el('msInventoryStatus'),coverage=el('msInventoryCoverage'),
    selectStore=el('msInventoryStore'),selectCategory=el('msInventoryCategory'),
    search=el('msInventorySearch'),table=el('msInventoryTable'),
    tbody=el('msInventoryRows'),moreButton=el('msInventoryMoreRows'),
    filtered=el('msInventoryFilterStatus');
  const ids=['msInventoryLoaded','msInventoryLow','msInventoryCut',
    'msInventoryFinished','msInventoryCovers','msInventoryDoorCards',
    'msInventoryUnverified','msInventoryStores',
    'msInventoryCutSummary','msInventoryFinishedSummary',
    'msInventoryCutTable','msInventoryFinishedTable',
    'msInventoryCutRows','msInventoryFinishedRows',
    'msInventoryCoversSummary','msInventoryCoversTable','msInventoryCoversRows',
    'msInventoryDoorCardsSummary','msInventoryDoorCardsTable','msInventoryDoorCardsRows'];
  if(!root||![runButton,pauseButton,continueButton,status,coverage,selectStore,
    selectCategory,search,table,tbody,moreButton,filtered].every(Boolean)||
    ids.some(id=>!el(id)))return;

  const n=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3});
  const f=value=>n.format(value);
  const clock=value=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',
    timeStyle:'short',timeZone:'Europe/Samara'}).format(new Date(value));
  const label={
    materials:'Материалы для чехлов',cut:'Крой для чехлов',
    finished:'Готовые комплекты',covers:'Авточехлы',
    doorCards:'Дверные карты и вставки',unverified:'Уточнить группу производства'
  };
  const value=x=>typeof x==='number'?f(x):'Неизвестно';
  const td=(tr,text)=>{
    const cell=document.createElement('td');
    cell.textContent=String(text);
    tr.append(cell);
    return cell;
  };
  const isVisible=()=>document.visibilityState==='visible'&&
    ['#production','#warehouse'].includes(location.hash.split('/')[0]);

  let items=[],expected=null,offset=0,pending=false,manualPause=false,
    lastStarted=0,pagesThisRun=0,viewLimit=180,loadedAt=null,
    lastRenderAt=0,problem=null;
  const complete=()=>expected!==null&&items.length===expected;
  const control=()=>{
    runButton.disabled=pending;
    pauseButton.disabled=!pending;
    continueButton.hidden=pending||complete()||offset===0;
  };
  const summaryText=rows=>unitTotals(rows).map(([unit,total])=>
    f(total)+' '+unit).join(' · ')||'Нет подтверждённых числовых остатков';
  const renderModelGroup=(category,summaryId,tableId,rowsId)=>{
    const entries=inventoryRows(items,'all','',category);
    const table=el(tableId),target=el(rowsId),summary=el(summaryId);
    target.replaceChildren();
    table.hidden=entries.length===0;
    if(entries.length===0){
      summary.textContent='Среди загруженной номенклатуры подтверждённая группа не найдена. '+
        'Это не означает отсутствие такого кроя или готовых комплектов в «МойСклад».';
      return;
    }
    summary.textContent='Позиции по фактической папке: '+f(entries.length)+
      '. Сумма учётных остатков по единицам в показанных складских строках: '+
      summaryText(entries)+'. '+
      (complete()?'Обход отчёта закончен, но страницы не одновременны.':
        'Обход отчёта ещё не закончен.');
    for(const row of entries.slice(0,120)){
      const tr=document.createElement('tr');
      td(tr,row.name||'Название не получено');
      td(tr,row.warehouse);
      td(tr,value(row.stock)+' '+(row.uom||'(единица не подтверждена)'));
      target.append(tr);
    }
    if(entries.length>120)summary.textContent+=' Показаны первые 120 строк этого раздела; '+
      'полный список доступен в основной таблице через фильтр.';
  };
  const show=()=>{
    const latest=items.length;
    let summary;
    try{summary=expected===null?null:summarizeInventory(items,latest,expected);}
    catch{
      status.textContent='Структура складского отчёта не подтверждена; сводку скрываем.';
      return;
    }
    const numberOrUnknown=(id,value)=>{el(id).textContent=value===null?'—':f(value);};
    numberOrUnknown('msInventoryLoaded',summary?.productionItems??null);
    numberOrUnknown('msInventoryLow',summary?.counts.low??null);
    numberOrUnknown('msInventoryCut',summary?.categories.cut??null);
    numberOrUnknown('msInventoryFinished',summary?.categories.finished??null);
    numberOrUnknown('msInventoryCovers',summary?.categories.covers??null);
    numberOrUnknown('msInventoryDoorCards',summary?.categories.doorCards??null);
    numberOrUnknown('msInventoryUnverified',summary?.categories.unverified??null);
    numberOrUnknown('msInventoryStores',summary?.warehouses.length??null);
    if(summary){
      const keep=selectStore.value;
      const known=['all',...summary.warehouses];
      selectStore.replaceChildren();
      for(const store of known){
        const option=document.createElement('option');
        option.value=store;
        option.textContent=store==='all'?'Все показанные склады':store;
        selectStore.append(option);
      }
      selectStore.value=known.includes(keep)?keep:'all';
      coverage.textContent='Просмотрено '+f(summary.loaded)+' из '+
        f(summary.expected)+' строк номенклатуры «МойСклад»; в пульте производства '+
        f(summary.productionItems)+' профильных позиций. '+
        (summary.complete?'Последняя страница получена; это не физическая инвентаризация и не единый моментальный снимок.':
          'Обход не завершён, итоговые показатели и перечень дефицитов неполные.')+
        ' Отрицательных складских строк: '+f(summary.counts.negative)+
        '; неизвестных остатков: '+f(summary.counts.unknownStock)+
        '. Последняя загрузка: '+(loadedAt?clock(loadedAt):'ещё не выполнялась')+'.';
    }
    const category=selectCategory.value;
    let rows;
    try{rows=inventoryRows(items,selectStore.value,search.value,category);}
    catch{rows=[];}
    // Do not display a fabricated zero: filtering may show zero rows while
    // the report itself is still only partially downloaded.
    filtered.textContent='По фильтру среди производственных позиций: '+f(rows.length)+
      ' строк. Показано до '+f(Math.min(rows.length,viewLimit))+
      '. Коврики и прочий ассортимент скрыты; предупреждения <40 м — на одном складе.';
    rows.sort((a,b)=>
      Number(b.negative)-Number(a.negative)||
      Number(b.low)-Number(a.low)||
      String(a.name||'').localeCompare(String(b.name||''),'ru')||
      a.warehouse.localeCompare(b.warehouse,'ru'));
    tbody.replaceChildren();
    for(const row of rows.slice(0,viewLimit)){
      const tr=document.createElement('tr');
      if(row.negative)tr.className='ms-inventory-negative';
      else if(row.low)tr.className='ms-inventory-low';
      td(tr,label[row.category]);
      td(tr,(row.name||'Имя не подтверждено')+(row.code?' · '+row.code:''));
      td(tr,row.catalogPath||'Не указана');
      td(tr,row.warehouse);
      td(tr,value(row.stock)+' '+(row.uom||'(единица неизвестна)'));
      td(tr,value(row.reserve));
      td(tr,value(row.inTransit));
      td(tr,row.negative?'Отрицательный остаток':
        row.low?'МЕНЬШЕ 40 М':
        row.stock===null?'Остаток не подтверждён':'—');
      tbody.append(tr);
    }
    table.hidden=rows.length===0;
    moreButton.hidden=rows.length<=viewLimit;
    renderModelGroup('cut','msInventoryCutSummary',
      'msInventoryCutTable','msInventoryCutRows');
    renderModelGroup('finished','msInventoryFinishedSummary',
      'msInventoryFinishedTable','msInventoryFinishedRows');
    renderModelGroup('covers','msInventoryCoversSummary',
      'msInventoryCoversTable','msInventoryCoversRows');
    renderModelGroup('doorCards','msInventoryDoorCardsSummary',
      'msInventoryDoorCardsTable','msInventoryDoorCardsRows');
    const top=document.getElementById('msExecutiveStock');
    if(top&&summary)top.textContent='В производстве: '+f(summary.productionItems)+
      ' позиций из '+f(summary.loaded)+' просмотренных';
    window.dispatchEvent(new CustomEvent('ms:production-inventory-ready',{
      detail:summary?{productionItems:summary.productionItems,
        lowMeterRows:summary.counts.low,complete:summary.complete}:null
    }));
    lastRenderAt=Date.now();
    control();
  };
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const PAGE=10,MAX_PAGES=60,WAIT_MS=2800,REFRESH_MS=30*60*1000;
  const start=async(force=false)=>{
    if(pending||!isVisible())return;
    if(force){
      items=[];offset=0;expected=null;loadedAt=null;viewLimit=180;
    }
    if(complete())return;
    lastStarted=Date.now();
    pending=true;manualPause=false;pagesThisRun=0;problem=null;control();
    status.textContent='Читаем реальные складские остатки «МойСклад»…';
    try{
      while(isVisible()&&!manualPause&&!complete()&&
        pagesThisRun<MAX_PAGES&&offset<=4990){
        const params=offset?'?offset='+offset:'';
        const response=await fetch('/api/ms/stock-bystore'+params,{
          method:'GET',credentials:'same-origin',cache:'no-store',
          headers:{Accept:'application/json'},
          signal:AbortSignal.timeout(45000)
        });
        let data;
        try{data=await response.json();}catch{throw Error('invalid_json');}
        if(!response.ok){
          const err=/^[a-z][a-z0-9_]{0,65}$/.test(data?.code||'')?
            data.code:'stock_unavailable';
          throw Error(err);
        }
        checkInventoryPage(data,offset);
        if(expected===null)expected=data.totalAssortmentReportRows;
        if(data.totalAssortmentReportRows!==expected)
          throw Error('assortment_total_changed_restart_required');
        items.push(...data.items);
        offset+=data.items.length;
        loadedAt=Date.now();pagesThisRun++;
        if(!data.hasMore&&items.length!==expected)
          throw Error('report_page_limit_reached');
        status.textContent='Просмотрено '+f(items.length)+' из '+f(expected)+
          ' строк каталога. В таблицах — только авточехлы, дверные карты и производство.';
        if(pagesThisRun===1||pagesThisRun%3===0||complete())show();
        if(complete())break;
        if(pagesThisRun<MAX_PAGES)await sleep(WAIT_MS);
      }
    }catch(error){
      problem=String(error?.message||'inventory_request_failed').slice(0,75);
    }finally{
      pending=false;show();control();
      if(problem){
        status.textContent='Обход прерван: '+problem+
          '. Уже полученные строки показаны как неполные; нулевые остатки не подставлены. '+
          'Для нового прохода нажмите «Обновить остатки».';
      }else if(complete()){
        status.textContent='Просмотрен весь отчёт «МойСклад» ('+f(items.length)+' строк). '+
          'Это учётные остатки на момент последовательных чтений страниц, не результаты физического пересчёта.';
      }else if(manualPause){
        status.textContent='Загрузка приостановлена. Получено '+f(items.length)+
          ' из '+f(expected||0)+'. Используйте «Загрузить следующую часть».';
      }else if(!isVisible()){
        status.textContent='Обход приостановлен при закрытии вкладки производства: '+f(items.length)+
          ' из '+f(expected||0)+'. При возвращении загрузка продолжится.';
      }else{
        status.textContent='Проверена ограниченная серия '+f(pagesThisRun)+
          ' страниц, получено '+f(items.length)+' из '+f(expected||0)+
          '. Продолжите для остальных позиций. Текущие итоги неполные.';
      }
    }
  };
  const maybeStart=()=>{
    if(!isVisible()||pending)return;
    if(!items.length&&!manualPause)void start();
    else if(!complete()&&!manualPause&&!problem)void start();
    else if(complete()&&Date.now()-lastStarted>REFRESH_MS)void start(true);
  };
  runButton.addEventListener('click',()=>{if(!pending)void start(true);});
  pauseButton.addEventListener('click',()=>{manualPause=true;});
  continueButton.addEventListener('click',()=>{if(!pending)void start(false);});
  moreButton.addEventListener('click',()=>{viewLimit+=180;show();});
  for(const control of [selectStore,selectCategory,search])
    control.addEventListener(control===search?'input':'change',()=>{
      viewLimit=180;show();
    });
  window.addEventListener('hashchange',maybeStart);
  document.addEventListener('visibilitychange',maybeStart);
  window.setInterval(maybeStart,60*1000);
  control();
  maybeStart();
})();
