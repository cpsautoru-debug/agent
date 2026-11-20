import {filterSnapshotItems,snapshotCounts} from './ms-warehouse-snapshot-view.mjs';

// Manual bounded snapshot: no automatic calls, no persistence, no writes.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const button=el('msWarehouseSnapshotLoad'),store=el('msWarehouseSnapshotStore');
  const status=el('msWarehouseSnapshotStatus'),count=el('msWarehouseSnapshotCount');
  const table=el('msWarehouseSnapshotTable'),rows=el('msWarehouseSnapshotRows');
  const category=el('msWarehouseSnapshotCategory');
  if(!button||!store||!status||!count||!table||!rows||!category)return;
  const format=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n);
  let pending=false,snapshot=null,loadedAt=null;
  const td=(row,value)=>{
    const cell=document.createElement('td');
    cell.textContent=String(value);
    row.append(cell);
    return cell;
  };
  const controls=()=>{
    button.disabled=pending;
    category.disabled=pending||!snapshot;
  };
  const clear=()=>{
    snapshot=null;loadedAt=null;
    rows.replaceChildren();table.hidden=true;
    category.value='all';
    count.textContent='Обзор не загружен.';
    controls();
  };
  const render=()=>{
    if(!snapshot)return;
    const matching=filterSnapshotItems(snapshot.items,category.value);
    const totals=snapshotCounts(snapshot.items);
    rows.replaceChildren();
    for(const item of matching){
      const row=document.createElement('tr');
      td(row,item.name+(item.code?' · '+item.code:''));
      td(row,typeof item.uom==='string'?item.uom:'Не указана');
      td(row,typeof item.catalogPath==='string'?item.catalogPath:'Группа не указана');
      const cell=td(row,typeof item.stock==='number'?format(item.stock):'Неизвестно');
      if(typeof item.stock==='number'&&item.stock<0)cell.className='ms-stock-negative';
      rows.append(row);
    }
    if(matching.length===0){
      const tr=document.createElement('tr');
      const cell=td(tr,'В подтверждённом снимке нет позиций этой группы. Это не означает отсутствия нулевых товаров.');
      cell.colSpan=4;rows.append(tr);
    }
    table.hidden=false;
    count.textContent='Склад: '+snapshot.warehouseName+
      '. Ненулевых позиций в текущем отчёте: '+format(totals.total)+
      '. Материалов по группе: '+format(totals.materials)+
      ', EVA-ковриков по группе: '+format(totals.eva)+
      ', других/неподтверждённых: '+format(totals.unverified)+
      '. Показано по фильтру: '+format(matching.length)+'.';
    status.textContent='Получен один ограниченный отчёт «МойСклад» · '+loadedAt+
      ' (Самара). '+snapshot.requests+' последовательных GET, без изменений данных. '+
      'Положительных '+format(snapshot.positiveRows)+
      ', отрицательных '+format(snapshot.negativeRows)+
      ', неизвестных '+format(snapshot.unknownRows)+
      '. Категории меняются без обращений к API. Это НЕ полная инвентаризация.';
  };
  const valid=data=>data?.code==='ms_warehouse_snapshot_ok'&&
    data.scope==='ONE_STORE_NONZERO_SNAPSHOT_MAX_40'&&
    data.source==='MOYSKLAD_BYSTORE_CURRENT_NONZERO'&&
    data.readOnly===true&&data.changedRecords===0&&
    data.completeForCurrentReport===true&&data.limit===40&&
    data.warehouseName===store.value&&
    Number.isSafeInteger(data.warehouseLines)&&data.warehouseLines>=0&&
    data.warehouseLines<=40&&
    data.itemCount===data.warehouseLines&&
    Array.isArray(data.items)&&data.items.length===data.itemCount&&
    data.namesResolved===data.itemCount&&
    Number.isSafeInteger(data.requests)&&data.requests>=2&&data.requests<=6&&
    Number.isSafeInteger(data.positiveRows)&&
    Number.isSafeInteger(data.negativeRows)&&
    Number.isSafeInteger(data.unknownRows)&&
    data.positiveRows+data.negativeRows+data.unknownRows===data.itemCount&&
    data.items.every(item=>typeof item.name==='string'&&item.name.length>0&&
      (item.stock===null||(typeof item.stock==='number'&&Number.isFinite(item.stock))));
  store.addEventListener('change',()=>{
    clear();
    status.textContent='Выбран другой склад. Для нового отчёта нажмите «Собрать обзор склада».';
  });
  category.addEventListener('change',()=>{if(snapshot&&!pending)render();});
  button.addEventListener('click',async()=>{
    if(pending)return;
    if(!store.value||document.visibilityState!=='visible'||
      location.hash.split('/')[0]!=='#production'){
      status.textContent='Выберите конкретный склад.';
      return;
    }
    const chosen=store.value;
    pending=true;clear();controls();
    status.textContent='Читаем один снимок склада «'+chosen+
      '» и получаем названия последовательно. При лимите/ошибке остановимся без частичного результата.';
    try{
      const response=await fetch('/api/ms/warehouse-snapshot?'+
        new URLSearchParams({store:chosen}).toString(),{
          method:'GET',credentials:'same-origin',cache:'no-store',
          headers:{Accept:'application/json'},signal:AbortSignal.timeout(140000)
        });
      const data=await response.json();
      if(!response.ok||!valid(data)){
        const code=typeof data?.code==='string'&&
          /^[a-z][a-z0-9_]{0,65}$/.test(data.code)?data.code:'invalid_snapshot_response';
        const http=Number.isInteger(data?.upstreamHttp)&&
          data.upstreamHttp>=300&&data.upstreamHttp<=599?' · HTTP '+data.upstreamHttp:'';
        throw Error(code+http);
      }
      snapshot=data;
      loadedAt=new Intl.DateTimeFormat('ru-RU',{
        timeZone:'Europe/Samara',dateStyle:'short',timeStyle:'short'
      }).format(new Date());
      render();
    }catch(error){
      clear();
      status.textContent='Полный краткий обзор не подтверждён: '+
        String(error?.message||'request_failed').slice(0,90)+
        '. Непроверенные позиции и остатки не отображаются. Старый постраничный просмотр доступен.';
    }finally{pending=false;controls();}
  });
  controls();
})();
