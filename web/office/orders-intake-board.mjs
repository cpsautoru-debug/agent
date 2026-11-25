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
     const coverage=k==='yandex'?'два магазина, первая страница (не вся очередь)':
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
})();
