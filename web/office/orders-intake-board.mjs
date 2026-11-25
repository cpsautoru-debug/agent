// Owner-triggered order intake board. Only existing read-only marketplace preview API.
// Never claim these first pages are a full fulfillment queue or write to MoySklad.
(()=>{
 'use strict';
 const root=document.getElementById('ordersIntakeBoard');
 if(!root)return;
 const el=id=>document.getElementById(id);
 const report=el('ordersIntakeStatus'),tbody=el('ordersIntakeRows'),table=el('ordersIntakeTable');
 const sources={
   ozon:{label:'Ozon FBS',coverage:'FBS_AWAITING_PACKAGING_LAST_7_DAYS_COMPLETE'},
   ozon_fbo:{label:'Ozon FBO',coverage:'FBO_LAST_7_DAYS_COMPLETE_NOT_FOR_SEWING'},
   wb:{label:'Wildberries FBS',coverage:'WB_NEW_FBS_ORDERS_API_SNAPSHOT'},
   yandex:{label:'Яндекс Маркет · 2 магазина',coverage:'BOTH_CAMPAIGNS_LAST_30_DAYS_COMPLETE'}
 };
 const sourceOrders=new Map(),stockResults=new Map(),approvedLinks=new Map();
 let mappingStorageReady=false;
 const mapButton=el('ordersSkuLinksRefresh'),mapStatus=el('ordersSkuLinksStatus'),
   mapRows=el('ordersSkuLinksRows'),mapTable=el('ordersSkuLinksTable');
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
    d.orders.length<=200&&d.complete===true&&d.counts?.received===d.orders.length&&
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
 const loadAllButton=el('ordersLoadAll');
 let loadAllBusy=false;
 if(loadAllButton)loadAllButton.addEventListener('click',async()=>{
   if(loadAllBusy||busy)return;
   loadAllBusy=true;loadAllButton.disabled=true;
   report.textContent='Последовательно читаем все подключённые кабинеты. Источники, завершившие выборку, появятся в общей таблице.';
   try{for(const source of Object.keys(sources))await load(source);}
   finally{loadAllBusy=false;loadAllButton.disabled=false;}
 });
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
     refreshStockCells();renderMappingCandidates();
     const coverage=k==='yandex'?('оба магазина · полная выборка за 30 дней · '+data.orders.length+' заказов'):
       k==='ozon_fbo'?'FBO, продажи со склада Ozon, не очередь пошива':
       k==='ozon'?'FBS: полная выборка статусов awaiting_packaging за 7 дней':'WB FBS: новые сборочные заказы из API';
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
       const parts=order.externalKey.split(':');
       const account=parts[2]||'';
       const matched=all.get(mapKey(order.source,account,item.sku));
       if(!matched)return item.sku+': ещё не сверено';
       if(matched.status==='conflict')return item.sku+': конфликт утверждённой связи ('+String(matched.reason||'проверить товар').slice(0,40)+')';
       if(matched.status==='unverified')return item.sku+': проверка не завершена ('+String(matched.reason||'нет данных').slice(0,40)+')';
       if(matched.status==='unmapped_sku')return item.sku+': нет подтверждённой связи SKU с МойСклад'+
         (matched.possibleNameCandidates?.length?' · кандидаты по названию: '+
           matched.possibleNameCandidates.map(x=>x.name).join(' / ')+
           ' (НЕ сопоставлено)':' · подходящих кандидатов не найдено');
       if(matched.status==='ambiguous')return item.sku+': несколько совпадений';
       if(!['matched_stock_report','mapped_stock_report'].includes(matched.status))return item.sku+': остаток неизвестен';
       const entries=matched.stores.filter(x=>x.accountingFree>=item.quantity);
       if(entries.length)
         return item.sku+': учётно достаточно на '+entries.map(x=>x.store).join(', ')+
           ' (физическое наличие не подтверждено)';
       return item.sku+': по учёту не хватает на одном складе; проверить физически';
     });
     td.textContent=findings.join('; ');
   }
 }
 const mapKey=(source,account,sku)=>[source,account,sku].join('\\u0001');
 function mappingEntries(){
   const unique=new Map();
   for(const [source,orders] of sourceOrders){
     for(const order of orders){
       if(order.productionQueue!=='candidate_needs_inventory')continue;
       const parts=order.externalKey.split(':');
       if(parts.length<4||parts[0]!=='AS63'||parts[1]!==source)continue;
       const account=parts[2];
       for(const item of order.items){
         const k=mapKey(source,account,item.sku);
         if(!unique.has(k))unique.set(k,{source,account,sku:item.sku});
       }
     }
   }
   return [...unique.values()];
 }
 function renderMappingCandidates(){
   if(!mapRows||!mapTable)return;
   mapRows.replaceChildren();
   for(const entry of mappingEntries()){
     const tr=document.createElement('tr');
     cell(tr,entry.source+' · '+entry.account);
     cell(tr,entry.sku);
     const link=approvedLinks.get(mapKey(entry.source,entry.account,entry.sku));
     const result=stockResults.get(mapKey(entry.source,entry.account,entry.sku));
     const td=document.createElement('td');
     if(link)td.textContent='Утверждено владельцем: '+link.ms_item_name;
     else if(result?.status==='unmapped_sku')
       td.textContent='Нет соответствия; предложения ниже требуют подтверждения';
     else if(result?.itemId)
       td.textContent='Точный SKU обнаружен, но постоянная связь не подтверждена';
     else td.textContent='Не подтверждено';
     tr.append(td);
     const action=document.createElement('td');
     const candidates=result?.possibleNameCandidates||
       (result?.itemId&&result?.itemType?[{id:result.itemId,
         type:result.itemType,name:result.itemName||result.itemId}]:[]);
     if(mappingStorageReady&&!link&&candidates.length){
       for(const candidate of candidates){
         if(!['product','variant','bundle'].includes(candidate.type)||!
            /^[a-f0-9-]{36}$/i.test(candidate.id))continue;
         const btn=document.createElement('button');
         btn.type='button';btn.className='ms-production-detail-button';
         const details=[candidate.type,candidate.name,
           candidate.article?'артикул '+candidate.article:'',
           candidate.code?'код '+candidate.code:'',
           Array.isArray(candidate.characteristics)?candidate.characteristics
             .map(x=>x.name+': '+x.value).join(', '):''].filter(Boolean).join(' · ');
         btn.title=details;
         btn.textContent='Проверить и связать: '+details;
         btn.addEventListener('click',()=>approve(entry,candidate));
         action.append(btn);
       }
     }else action.textContent=link?'Связь сохранена':
       !mappingStorageReady?'Справочник пока не активирован':'Нет подтверждённых кандидатов';
     tr.append(action);mapRows.append(tr);
   }
   mapTable.hidden=mapRows.children.length===0;
 }
 async function refreshLinks(){
   if(!mapButton)return;
   mapButton.disabled=true;
   mapStatus.textContent='Читаем сохранённый справочник D1…';
   try{
     const response=await fetch('/api/ms/order-sku-links',{credentials:'same-origin',
       headers:{Accept:'application/json'},cache:'no-store'});
     const data=await response.json();
     if(!response.ok||data?.code!=='sku_links_read'||
       !Array.isArray(data.approvedLinks))throw Error(data?.code||'api_unavailable');
     approvedLinks.clear();mappingStorageReady=true;
     for(const row of data.approvedLinks){
       if(row&&typeof row.source==='string'&&typeof row.seller_account==='string'&&
         typeof row.marketplace_sku==='string')
         approvedLinks.set(mapKey(row.source,row.seller_account,row.marketplace_sku),row);
     }
     mapStatus.textContent='Сохранено утверждённых связей: '+approvedLinks.size+
       (data.hasMore?' (показаны первые 200)':'')+
       '. Автоматическое списание не включено.';
     renderMappingCandidates();
   }catch(error){
     approvedLinks.clear();mappingStorageReady=false;renderMappingCandidates();
     mapStatus.textContent=String(error?.message)==='sku_links_storage_unavailable'?
       'Справочник создан в коде, но D1-таблица пока не активирована. Требуется применение миграции.':
       'Справочник недоступен: '+String(error?.message||'ошибка').slice(0,70);
   }finally{mapButton.disabled=false;}
 }
 async function approve(entry,candidate){
   if(busy||!mappingStorageReady||!confirm('Подтвердить связь '+entry.source+' / '+entry.sku+
     ' с товаром МойСклад «'+candidate.name+'»? Это сохранит только соответствие SKU, не изменит остатки.'))return;
   busy=true;
   mapStatus.textContent='Проверяем товар и сохраняем выбранную связь…';
   try{
     const response=await fetch('/api/ms/order-sku-links',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'Content-Type':'application/json',Accept:'application/json'},
       body:JSON.stringify({source:entry.source,sellerAccount:entry.account,
         sku:entry.sku,itemType:candidate.type,itemId:candidate.id})
     });
     const data=await response.json();
     if(response.status!==201||data?.code!=='sku_link_approved')
       throw Error(data?.code||'link_not_saved');
     mapStatus.textContent='Связь сохранена в D1. Для проверки остальных товаров нажмите «Обновить справочник».';
   }catch(error){
     mapStatus.textContent='Связь не сохранена: '+
       String(error?.message||'ошибка').slice(0,90);
   }finally{busy=false;await refreshLinks();}
 }
 if(mapButton)mapButton.addEventListener('click',refreshLinks);
 if(stockButton)stockButton.addEventListener('click',async()=>{
   if(busy)return;
   const candidates=mappingEntries();
   if(!candidates.length){stockStatus.textContent='Нет кандидатов из проверенных выборок. Сначала загрузите FBS-заказы.';return;}
   if(candidates.length>20){stockStatus.textContent='Более 20 сочетаний кабинет/SKU: ограниченный безопасный пакет. Данные не изменены.';return;}
   busy=true;stockButton.disabled=true;buttons.forEach(b=>b.disabled=true);
   stockStatus.textContent='Получаем полный учётный каталог и остатки по складам МойСклад (только чтение)…';
   try{
     const response=await fetch('/api/ms/orders-stock-match',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'Content-Type':'application/json',Accept:'application/json'},
       body:JSON.stringify({entries:candidates}),signal:AbortSignal.timeout(90000)
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
       !Array.isArray(data.matches)||data.matches.length!==candidates.length)
       throw Error('Формат или полнота ответа не подтверждены');
     stockResults.clear();
     for(const result of data.matches){
       if(candidates.some(x=>x.source===result.source&&x.account===result.sellerAccount&&x.sku===result.sku)&&
         ['not_matched','ambiguous','matched_stock_report','matched_stock_unknown',
          'mapped_stock_report','mapped_stock_unknown','conflict','unverified','unmapped_sku'].includes(result.status))
         stockResults.set(mapKey(result.source,result.sellerAccount,result.sku),result);
     }
     if(stockResults.size!==candidates.length)throw Error('stock_items_unverified');
     refreshStockCells();renderMappingCandidates();
     const matched=[...stockResults.values()].filter(x=>['matched_stock_report','mapped_stock_report'].includes(x.status)).length;
     stockStatus.textContent='Запрошено '+candidates.length+' кабинет/SKU; проверено точных или утверждённых соответствий с учётным остатком: '+
       matched+'. Данные неатомарны и не подтверждают физическое наличие или готовность отгрузки. '+
       'Ни одного резерва, задания или отгрузки не создано.';
   }catch(error){
     stockResults.clear();refreshStockCells();renderMappingCandidates();
     stockStatus.textContent='Сверка не подтверждена: '+String(error?.message||'нет данных').slice(0,150)+
       '. Решения о пошиве и отгрузках не принимаем.';
   }finally{busy=false;stockButton.disabled=false;buttons.forEach(b=>b.disabled=false);}
 });
})();
