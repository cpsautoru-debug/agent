// Owner-triggered, one-store nonzero report. Separate from ten-row stock page.
// Deliberately no automatic calls, storage, timers, or full-inventory claims.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const button=el('msWarehouseAvailabilityRefresh');
  const selector=el('msStockWarehouse');
  const status=el('msWarehouseAvailabilityStatus');
  const summary=el('msWarehouseAvailabilitySummary');
  const table=el('msWarehouseAvailabilityTable');
  const rows=el('msWarehouseAvailabilityRows');
  if(!button||!selector||!status||!summary||!table||!rows)return;
  const count=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n);
  const td=(tr,value)=>{
    const cell=document.createElement('td');
    cell.textContent=value;
    tr.append(cell);
  };
  let pending=false;
  const clear=()=>{
    rows.replaceChildren();
    table.hidden=true;
    summary.textContent='Данные этого склада ещё не загружены.';
  };
  const visible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  selector.addEventListener('change',()=>{
    clear();
    status.textContent='Чтобы получить наличие по всему выбранному складу, нажмите кнопку проверки.';
  });
  button.addEventListener('click',async()=>{
    const store=selector.value;
    if(!store||pending||!visible()){
      status.textContent='Сначала загрузите остатки и выберите один склад.';
      return;
    }
    pending=true;button.disabled=true;selector.disabled=true;
    clear();
    status.textContent='Читаем краткий отчёт только одного выбранного склада…';
    try{
      const q=new URLSearchParams({store});
      const response=await fetch('/api/ms/warehouse-availability?'+q.toString(),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(75000)
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
        !Array.isArray(data.items)||data.items.length>10||
        data.displayedCount!==data.items.length||
        data.additionalRows!==data.warehouseLines-data.displayedCount||
        !Number.isSafeInteger(data.namesResolved)||data.namesResolved>data.items.length||
        ![2,3].includes(data.requests))
        throw Error('invalid_warehouse_response');
      rows.replaceChildren();
      for(const item of data.items){
        const tr=document.createElement('tr');
        td(tr,typeof item.name==='string'?item.name+
          (typeof item.code==='string'?' · '+item.code:''):'Название не получено');
        td(tr,typeof item.uom==='string'?item.uom:'Не указана');
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
        count(data.warehouseLines)+'. Показано: '+count(data.items.length)+
        '. Положительных '+count(data.positiveRows)+
        ', отрицательных '+count(data.negativeRows)+
        ', неизвестных '+count(data.unknownRows)+
        '. '+(data.additionalRows>0?'Остальные '+count(data.additionalRows)+
          ' позиции пока не отображаются. ':'')+
        'Это краткий отчёт о ненулевом наличии, НЕ полная инвентаризация.';
      status.textContent='Краткий отчёт «МойСклад» получен · '+
        new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Samara',
          dateStyle:'short',timeStyle:'short'}).format(new Date())+
        ' (Самара). Резерв и ожидание здесь не учитываются.';
    }catch(e){
      clear();
      status.textContent='Не удалось подтвердить наличие склада: '+
        String(e?.message||'request_failed').slice(0,85)+
        '. Нули и остатки не подставлены.';
    }finally{
      pending=false;button.disabled=false;selector.disabled=false;
    }
  });
})();
