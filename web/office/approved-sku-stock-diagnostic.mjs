// Read-only diagnostics for approved marketplace SKU; not a sewing queue.
(()=>{
 'use strict';
 const load=document.getElementById('approvedSkuStockLoad');
 if(!load)return;
 const select=document.getElementById('approvedSkuStockSelect');
 const check=document.getElementById('approvedSkuStockCheck');
 const status=document.getElementById('approvedSkuStockStatus');
 const output=document.getElementById('approvedSkuStockResults');
 let rows=[],busy=false;
 const encode=x=>[x.source,x.seller_account,x.marketplace_sku].join('\u001f');
 const request=async(url,init={})=>{
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{})},
   signal:AbortSignal.timeout(110000),...init});
  const data=await r.json();
  if(!r.ok)throw Error(data?.code||'api_unavailable');
  return data;
 };
 load.addEventListener('click',async()=>{
  if(busy)return;
  busy=true;load.disabled=true;check.disabled=true;output.replaceChildren();
  try{
   const data=await request('/api/ms/order-sku-links');
   if(data.code!=='sku_links_read'||!Array.isArray(data.approvedLinks))
    throw Error('mapping_data_unverified');
   rows=data.approvedLinks.filter(x=>['ozon','wb','yandex'].includes(x.source)&&
    typeof x.seller_account==='string'&&typeof x.marketplace_sku==='string');
   select.replaceChildren(...rows.map(x=>
    new Option(x.source+' · '+x.seller_account+' · '+x.marketplace_sku+
     ' → '+x.ms_item_name,encode(x))));
   check.disabled=rows.length===0;
   status.textContent='Подтверждённых SKU для проверки: '+rows.length+
     '. Данные не обновляют склад, резерв или производственные документы.';
  }catch(e){status.textContent='Справочник недоступен: '+String(e.message).slice(0,100);}
  finally{busy=false;load.disabled=false;}
 });
 check.addEventListener('click',async()=>{
  if(busy)return;
  const link=rows.find(x=>encode(x)===select.value);
  if(!link)return;
  busy=true;check.disabled=true;output.replaceChildren();
  status.textContent='Читаем актуальные учётные данные МойСклад для '+link.marketplace_sku+'…';
  try{
   const current=await request('/api/ms/approved-sku-stock-current',{
     method:'POST',body:JSON.stringify({
       source:link.source,sellerAccount:link.seller_account,sku:link.marketplace_sku
     })});
   if(Array.isArray(current.diagnostics)){
    const detail=document.createElement('details');
    const summary=document.createElement('summary');
    summary.textContent='Диагностика запросов МойСклад';
    const observations=document.createElement('pre');
    observations.textContent=JSON.stringify(current.diagnostics,null,2);
    detail.append(summary,observations);
    output.append(detail);
   }
   if(current.code!=='approved_stock_current'||current.readOnly!==true||
      current.changedRecords!==0||current.itemId!==link.ms_item_id||
      !Number.isFinite(current.stock)||!Number.isFinite(current.reserve)||
      !Number.isFinite(current.accountingFree)){
    status.textContent='Остаток и резерв не подтверждены ('+current.code+').';
    return;
   }
   const stores=[{store:current.storeName||current.storeId,stock:current.stock,
     reserve:current.reserve,accountingFree:current.accountingFree}];
   const reportName=current.itemName,reportId=current.itemId;
   const readMode=current.report==='expanded_exact'?'расширенный отчёт по UUID':'краткий отчёт stock/reserve/freeStock';
   const heading=document.createElement('p');
   heading.textContent='Товар: '+reportName+' · UUID '+reportId+
    ' · проверено: '+(current.checkedAt||'время не указано')+'.';
   output.append(heading);
   const table=document.createElement('table');
   table.className='ms-production-table';
   const thead=document.createElement('thead');
   const head=document.createElement('tr');
   for(const text of ['Склад','Учётный остаток','Резерв','Остаток за вычетом резерва']){
    const th=document.createElement('th');th.textContent=text;head.append(th);
   }
   thead.append(head);table.append(thead);
   const tbody=document.createElement('tbody');
   for(const store of stores){
    const tr=document.createElement('tr');
    for(const value of [store.store,store.stock,store.reserve,store.accountingFree]){
     const td=document.createElement('td');td.textContent=String(value??'Не подтверждено');
     tr.append(td);
    }
    tbody.append(tr);
   }
   table.append(tbody);output.append(table);
   status.textContent='Получен учётный отчёт: '+readMode+'. Резерв вычтен только один раз. '+
    'Дополнительная занятость других заказов, полнота резерва, физический запас и '+
    'потребность в пошиве НЕ подтверждены.';
  }catch(e){
   status.textContent='Проверка не завершена: '+String(e.message).slice(0,100)+
     '. Остаток и резерв не установлены.';
  }finally{busy=false;check.disabled=false;}
 });
})();
