// Owner-triggered, one-store nonzero report with bounded pages of ten.
// No automatic polling, storage, full-inventory claims or writes.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const button=el('msWarehouseAvailabilityRefresh');
  const selector=el('msStockWarehouse');
  const status=el('msWarehouseAvailabilityStatus');
  const summary=el('msWarehouseAvailabilitySummary');
  const table=el('msWarehouseAvailabilityTable');
  const rows=el('msWarehouseAvailabilityRows');
  const prev=el('msWarehouseAvailabilityPrev');
  const next=el('msWarehouseAvailabilityNext');
  const page=el('msWarehouseAvailabilityPage');
  if(!button||!selector||!status||!summary||!table||!rows||!prev||!next||!page)return;
  const count=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n);
  const td=(tr,value)=>{
    const cell=document.createElement('td');
    cell.textContent=value;
    tr.append(cell);
  };
  let pending=false,loaded=false,pageIndex=0,hasNext=false;
  const controls=()=>{
    button.disabled=pending;
    selector.disabled=pending;
    prev.disabled=pending||!loaded||pageIndex===0;
    next.disabled=pending||!loaded||!hasNext;
    page.textContent='Страница '+(pageIndex+1);
  };
  const clear=()=>{
    rows.replaceChildren();
    table.hidden=true;loaded=false;hasNext=false;
    summary.textContent='Данные этого склада ещё не загружены.';
    controls();
  };
  const visible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  selector.addEventListener('change',()=>{
    pageIndex=0;
    clear();
    status.textContent='Чтобы получить наличие по всему выбранному складу, нажмите кнопку проверки.';
  });
  const readPage=async()=>{
    const store=selector.value;
    if(!store||pending||!visible()){
      status.textContent='Сначала загрузите остатки и выберите один склад.';
      return;
    }
    pending=true;controls();
    clear();
    status.textContent='Читаем краткий отчёт выбранного склада, страницу '+(pageIndex+1)+'…';
    try{
      const q=new URLSearchParams({store});
      if(pageIndex)q.set('page',String(pageIndex));
      const response=await fetch('/api/ms/warehouse-availability?'+q.toString(),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(85000)
      });
      const data=await response.json();
      if(!response.ok){
        const code=typeof data?.code==='string'&&
          /^[a-z][a-z0-9_]{0,60}$/.test(data.code)?data.code:'invalid_warehouse_response';
        const http=Number.isInteger(data?.upstreamHttp)&&
          data.upstreamHttp>=300&&data.upstreamHttp<=599?' · HTTP '+data.upstreamHttp:'';
        throw Error(code+http);
      }
      if(data?.code!=='ms_warehouse_availability_ok'||
        data.source!=='MOYSKLAD_BYSTORE_CURRENT_NONZERO'||
        data.scope!=='WAREHOUSE_NONZERO_POSITIONS_ONLY_NOT_FULL_INVENTORY'||
        data.warehouseName!==store||data.stockType!=='stock'||
        data.readOnly!==true||data.changedRecords!==0||
        !Number.isSafeInteger(data.warehouseLines)||data.warehouseLines>500||
        !Number.isSafeInteger(data.page)||data.page!==pageIndex||
        data.pageSize!==10||data.hasPrevious!==(pageIndex>0)||
        typeof data.hasNext!=='boolean'||
        !Array.isArray(data.items)||data.items.length>10||
        data.displayedCount!==data.items.length||
        data.additionalRows!==Math.max(0,data.warehouseLines-
          pageIndex*10-data.displayedCount)||
        data.hasNext!==(data.additionalRows>0)||
        !Number.isSafeInteger(data.namesResolved)||data.namesResolved>data.items.length||
        ![2,3,4].includes(data.requests))
        throw Error('invalid_warehouse_response');
      rows.replaceChildren();
      for(const item of data.items){
        const tr=document.createElement('tr');
        td(tr,typeof item.name==='string'?item.name+
          (typeof item.code==='string'?' · '+item.code:''):'Название не получено');
        td(tr,typeof item.uom==='string'?item.uom:'Не указана');
        td(tr,typeof item.catalogPath==='string'&&item.catalogPath.trim()?
          item.catalogPath:'Группа не указана');
        const qty=typeof item.stock==='number'&&Number.isFinite(item.stock)?
          count(item.stock):'Неизвестно';
        const num=document.createElement('td');
        num.textContent=qty;
        if(typeof item.stock==='number'&&item.stock<0)num.className='ms-stock-negative';
        tr.append(num);
        rows.append(tr);
      }
      table.hidden=data.items.length===0;
      summary.textContent='Склад: '+store+'. Позиции с ненулевым учётным остатком: '+
        count(data.warehouseLines)+'. Показано на странице '+(pageIndex+1)+': '+
        count(data.items.length)+
        '. Положительных '+count(data.positiveRows)+
        ', отрицательных '+count(data.negativeRows)+
        ', неизвестных '+count(data.unknownRows)+
        '. '+(data.additionalRows>0?'После этой страницы осталось '+
          count(data.additionalRows)+' позиций. ':'')+
        'Единицы измерения выводятся только если подтверждены API. '+
        'Это НЕ полная инвентаризация.';
      status.textContent='Краткий отчёт «МойСклад» получен · '+
        new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Samara',
          dateStyle:'short',timeStyle:'short'}).format(new Date())+
        ' (Самара). Каждая страница проверяется отдельно; данные могут измениться между запросами. Резерв и ожидание здесь не учитываются.';
      loaded=true;hasNext=data.hasNext;
    }catch(e){
      clear();
      status.textContent='Не удалось подтвердить наличие склада: '+
        String(e?.message||'request_failed').slice(0,85)+
        '. Нули и остатки не подставлены.';
    }finally{
      pending=false;controls();
    }
  };
  button.addEventListener('click',()=>{if(pending)return;pageIndex=0;readPage();});
  prev.addEventListener('click',()=>{
    if(!pending&&loaded&&pageIndex>0){pageIndex--;readPage();}
  });
  next.addEventListener('click',()=>{
    if(!pending&&loaded&&hasNext&&pageIndex<49){pageIndex++;readPage();}
  });
  controls();
})();
