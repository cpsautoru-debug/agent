// Owner-triggered order intake board. Only existing read-only marketplace preview API.
// Never claim these first pages are a full fulfillment queue or write to MoySklad.
(()=>{
 'use strict';
 const root=document.getElementById('ordersIntakeBoard');
 if(!root)return;
 const el=id=>document.getElementById(id);
 const report=el('ordersIntakeStatus'),tbody=el('ordersIntakeRows'),table=el('ordersIntakeTable');
 const sources={
   ozon:{label:'Ozon FBS',coverage:'FBS_AWAITING_PACKAGING_FIRST_PAGE_LAST_7_DAYS'},
   ozon_fbo:{label:'Ozon FBO',coverage:'FBO_FIRST_PAGE_LAST_7_DAYS_NOT_PRODUCTION_QUEUE'},
   wb:{label:'Wildberries FBS',coverage:'FBS_NEW_FIRST_PAGE_ONLY_NOT_ALL_MARKETPLACE_ORDERS'},
   yandex:{label:'Яндекс Маркет · 2 магазина',coverage:'FIRST_PAGE_BOTH_SHOPS_NOT_COMPLETE_QUEUE'}
 };
 const sourceOrders=new Map(),stockResults=new Map();
 const stockButton=el('ordersStockCheck'),stockStatus=el('ordersStockStatus');
 const blocks=Object.fromEntries(Object.keys(sources).map(k=>[k,el('ordersSource_'+k)]));
 let busy=false;
 const cell=(tr,value)=>{const td=document.createElement('td');td.textContent=String(value??'Не подтверждено');tr.append(td);};
 function valid(d,k){
   if(k==='yandex')return d?.code==='yandex_orders_preview_ok'&&
     d.readOnly===true&&d.changedRecords===0&&d.approvedForWrite===false&&
     d.coverage===sources[k].coverage&&Array.isArray(d.campaignIds)&&
     d.campaignIds.length===2&&Array.isArray(d.orders)&&
     d.received===d.orders.length&&d.orders.length<=10&&
     d.orders.every(o=>o?.source==='yandex'&&
       typeof o.externalKey==='string'&&o.externalKey.startsWith('AS63:yandex:')&&
       o.readyToWrite===false&&o.assortmentVerified===false&&
       o.legalEntityVerified===false&&o.duplicateStatus==='unverified'&&
       Array.isArray(o.items)&&o.items.every(p=>
         typeof p.sku==='string'&&Number.isSafeInteger(p.quantity)&&p.quantity>0));
   return d?.code==='marketplace_order_import_preview_ok'&&d.source===k&&
    d.readOnly===true&&d.changedRecords===0&&d.approvedForWrite===false&&
    d.coverage===sources[k].coverage&&Array.isArray(d.orders)&&
    d.orders.length<=10&&d.counts?.received===d.orders.length&&
    d.orders.every(o=>o?.source===k&&typeof o.externalKey==='string'&&
      o.externalKey.startsWith('AS63:')&&Array.isArray(o.items)&&
      o.readyToWrite===false&&o.assortmentVerified===false&&
      o.legalEntityVerified===false&&
      o.items.every(p=>typeof p.sku==='string'&&Number.isSafeInteger(p.quantity)&&p.quantity>0));
 }
 function add(k,d){
   for(const order of d.orders){
     const tr=document.createElement('tr');
     cell(tr,sources[k].label);cell(tr,order.externalKey);
     cell(tr,order.items.map(p=>p.sku+' × '+p.quantity).join('; '));
     cell(tr,(order.programType?order.programType+' · ':'')+(order.status||'Статус неизвестен'));

     cell(tr,order.productionQueue==='not_for_sewing'?'Не отправлять в пошив':
       order.productionQueue==='candidate_needs_inventory'?'Проверить остаток и назначение':'Назначение не подтверждено');
     cell(tr,order.duplicateStatus==='already_exists'?'Совпадение по ID найдено':
       order.duplicateStatus==='not_found'?'По новому ID совпадения нет · старые дубли возможны':'Дубли не исключены');
     cell(tr,'Без подтверждения SKU/юрлица · запись выключена');
     const evidence=document.createElement('td');
     evidence.dataset.stockFor=order.externalKey;
     evidence.textContent='Не проверялось';
     tr.append(evidence);
     tbody.append(tr);
   }
   table.hidden=tbody.children.length===0;
 }
 const buttons=[...root.querySelectorAll('[data-order-source]')];
 async function load(k){
   if(busy||!sources[k]||location.hash.split('/')[0]!=='#orders')return;
   busy=true;buttons.forEach(b=>b.disabled=true);
   const badge=blocks[k];if(badge)badge.textContent='Чтение API…';
   report.textContent='Проверяем '+sources[k].label+' и дубли МойСклад. Только чтение.';
   try{
     const res=await fetch(k==='yandex'?'/api/yandex/orders-preview':
       '/api/marketplace/order-import-preview?source='+encodeURIComponent(k),{
       credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},
       signal:AbortSignal.timeout(150000)
     });
     const data=await res.json();
     if(!res.ok){
       const name=typeof data?.code==='string'?data.code:'api_unavailable';
       const message=res.status===401?'Нужно войти в офис как владелец':
         res.status===403?'Недостаточно прав владельца':
         'Ошибка источника: '+name+(Number.isSafeInteger(data?.upstreamHttp)?' · HTTP '+data.upstreamHttp:'');
       if(badge)badge.textContent=message;report.textContent=message+'; документы не создавались.';
       return;
     }
     if(!valid(data,k))throw Error('Неподтверждённый формат или полнота ответа');
     // Replace rows for this source, preserving results previously loaded from others.
     for(const tr of [...tbody.children])if(tr.dataset.source===k)tr.remove();
     const before=tbody.children.length;
     add(k,data);
     for(const tr of [...tbody.children].slice(before))tr.dataset.source=k;
     sourceOrders.set(k,data.orders);
     stockResults.clear();
     refreshStockCells();
     const coverage=k==='yandex'?('два магазина доступны; в выборке представлены '+
       new Set(data.orders.map(o=>o.campaignId)).size+' из 2; первая страница'):
       k==='ozon_fbo'?'FBO, продажи со склада Ozon, НЕ очередь пошива':
       k==='ozon'?'FBS: первая страница за 7 дней':'FBS: только первая страница новых заданий';
     if(badge)badge.textContent=data.orders.length+' строк · '+coverage;
     report.textContent='Получено '+data.orders.length+' заказов '+sources[k].label+
       '. Это ограниченная выборка, не полная очередь. Заказов без подтверждённого соответствия для записи: '+
       data.orders.length+'. Документы МойСклад не создавались.';
   }catch(error){
     const message=error?.name==='TimeoutError'?'Превышено время ответа':
       'Не удалось проверить источник/формат';
     if(badge)badge.textContent=message;
     report.textContent=message+'. Результаты предыдущих источников могут оставаться на экране; запись выключена.';
   }finally{busy=false;buttons.forEach(b=>b.disabled=false);}
 }
 buttons.forEach(b=>b.addEventListener('click',()=>load(b.dataset.orderSource)));
 function refreshStockCells(){
   const orders=[...sourceOrders.values()].flat();
   const all=stockResults;
   for(const tr of tbody.children){
     const td=tr.querySelector('[data-stock-for]');if(!td)continue;
     const order=orders.find(o=>o.externalKey===td.dataset.stockFor);
     if(!order){td.textContent='Нет данных';continue;}
     if(order.productionQueue!=='candidate_needs_inventory'){
       td.textContent='Не относится к очереди пошива';continue;
     }
     const findings=order.items.map(item=>{
       const matched=all.get(item.sku);
       if(!matched)return item.sku+': ещё не сверено';
       if(matched.status==='unverified')return item.sku+': проверка не завершена ('+String(matched.reason||'нет данных').slice(0,40)+')';
       if(matched.status==='not_matched')return item.sku+': точного совпадения нет';
       if(matched.status==='ambiguous')return item.sku+': несколько совпадений';
       if(matched.status!=='matched_stock_report')return item.sku+': остаток неизвестен';
       const entries=matched.stores.filter(x=>x.accountingFree>=item.quantity);
       if(entries.length)
         return item.sku+': учётно достаточно на '+entries.map(x=>x.store).join(', ')+
           ' (физическое наличие не подтверждено)';
       return item.sku+': по учёту не хватает на одном складе; проверить физически';
     });
     td.textContent=findings.join('; ');
   }
 }
 if(stockButton)stockButton.addEventListener('click',async()=>{
   if(busy)return;
   const candidates=[...sourceOrders.values()].flat()
     .filter(o=>o.productionQueue==='candidate_needs_inventory');
   const sku=[...new Set(candidates.flatMap(o=>o.items.map(x=>x.sku)))];
   if(!sku.length){stockStatus.textContent='Нет кандидатов из проверенных выборок. Сначала загрузите FBS-заказы.';return;}
   if(sku.length>20){stockStatus.textContent='Более 20 артикулов: ограниченный безопасный пакет. Требуется расширенный режим сверки; данные не изменены.';return;}
   busy=true;stockButton.disabled=true;buttons.forEach(b=>b.disabled=true);
   stockStatus.textContent='Получаем полный учётный каталог и остатки по складам МойСклад (только чтение)…';
   try{
     const response=await fetch('/api/ms/orders-stock-match',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'Content-Type':'application/json',Accept:'application/json'},
       body:JSON.stringify({skus:sku}),signal:AbortSignal.timeout(90000)
     });
     const data=await response.json();
     if(!response.ok){
       const allowed=['rate_limited','token_rejected','permission_denied',
         'upstream_rejected','snapshot_unverified','snapshot_incomplete',
         'snapshot_limit','stock_duplicate_item','stock_stores_unverified',
         'response_too_large','stock_match_unavailable'];
       const stage=['catalog','stock_report','matching'].includes(data?.stage)?
         data.stage:'unknown';
       const code=allowed.includes(data?.code)?data.code:'source_unavailable';
       const http=Number.isSafeInteger(data?.http)?' HTTP '+data.http:'';
       throw Error('Проверка прервана: '+stage+' / '+code+http);
     }
     if(data?.code!=='ms_orders_stock_match'||
       data.readOnly!==true||data.changedRecords!==0||
       data.targetedSkuChecks!==true||
       !Array.isArray(data.matches)||data.matches.length!==sku.length)
       throw Error('Формат или полнота ответа не подтверждены');
     stockResults.clear();
     for(const result of data.matches){
       if(sku.includes(result.sku)&&['not_matched','ambiguous',
         'matched_stock_report','matched_stock_unknown','unverified'].includes(result.status))
         stockResults.set(result.sku,result);
     }
     if(stockResults.size!==sku.length)throw Error('stock_items_unverified');
     refreshStockCells();
     const matched=[...stockResults.values()].filter(x=>x.status==='matched_stock_report').length;
     stockStatus.textContent='Запрошено '+sku.length+' SKU; подтверждённых точных совпадений с учётным остатком: '+
       matched+'. Данные неатомарны и не подтверждают физическое наличие или готовность отгрузки. '+
       'Ни одного резерва, задания или отгрузки не создано.';
   }catch(error){
     stockResults.clear();refreshStockCells();
     stockStatus.textContent='Сверка не подтверждена: '+String(error?.message||'нет данных').slice(0,150)+
       '. Решения о пошиве и отгрузках не принимаем.';
   }finally{busy=false;stockButton.disabled=false;buttons.forEach(b=>b.disabled=false);}
 });
})();
