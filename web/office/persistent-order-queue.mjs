// Staging owner-only D1 mirror. Never writes to MoySklad.
(()=>{
 'use strict';
 const table=document.getElementById('persistentOrdersTable');
 if(!table)return;
 const tbody=document.getElementById('persistentOrdersRows'),
   status=document.getElementById('persistentOrdersStatus'),
   sync=document.getElementById('persistentOrdersSync'),
   refresh=document.getElementById('persistentOrdersRefresh'),
   bucketSelect=document.getElementById('persistentOrdersBucket'),
   bucketSummary=document.getElementById('persistentOrdersBucketCounts'),
   workflowStatus=document.getElementById('persistentOrdersWorkflowStatus'),
   precheckStatus=document.getElementById('persistentOrdersStockPrecheckStatus');
 const workflowEndpoint='/api/orders/workflow-review';
 const workflowByKey=new Map();
 let workflowReady=false;
 let latest=null;
 let working=false;
 const endpoint='/api/orders/persistent-queue';
 const sources=['ozon','ozon_fbo','wb','yandex','manual'];
 const cell=(tr,t)=>{const td=document.createElement('td');td.textContent=String(t??'—');tr.append(td);};
 function render(data){
   latest=data;
   const counts=data.bucketCounts||{active:0,transit:0,history:0,review:0};
   const current=bucketSelect?.value||'active';
   const labels={active:'Активен — проверить SKU и остаток',
     transit:'В доставке — не направлять в пошив',
     history:'История — не направлять в пошив',
     review:'Требует уточнения — не направлять в пошив'};
   tbody.replaceChildren();
   const matching=data.orders.filter(o=>current==='all'||o.queue_bucket===current);
   for(const order of matching){
     const tr=document.createElement('tr');
     cell(tr,order.source+' · '+order.account);
     cell(tr,order.external_id);
     cell(tr,order.items.map(i=>(i.sku||i.name||i.itemId)+' × '+i.quantity).join('; '));
     cell(tr,order.source_status);
     cell(tr,labels[order.queue_bucket]||labels.review);
     cell(tr,order.source_checked_at);
     const td=document.createElement('td');
     const entry=workflowByKey.get(order.order_key);
     const state=entry?.workflow_state||'pending_review';
     const stateNames={pending_review:'Ожидает просмотра',reviewed:'Просмотрено',
       stock_check_requested:'Проверить остаток',on_hold:'Приостановлено'};
     td.append(document.createTextNode(stateNames[state]||'Неизвестный этап'));
     if(workflowReady&&order.queue_bucket==='active'){
       const actions={
         pending_review:[['mark_reviewed','Подтвердить просмотр'],['hold','Приостановить']],
         reviewed:[['request_stock_check','Запросить проверку остатка'],['hold','Приостановить']],
         stock_check_requested:[['hold','Приостановить']],
         on_hold:[['resume_review','Возобновить просмотр']]
       };
       for(const [action,title] of actions[state]||[]){
         const button=document.createElement('button');button.type='button';
         button.className='ms-production-detail-button';
         button.textContent=title;
         button.style.margin='4px';
         button.addEventListener('click',()=>transition(order,entry,action,button));
         td.append(button);
       }
     }
     tr.append(td);
     if(order.queue_bucket==='active'){
       const button=document.createElement('button');
       button.type='button';button.className='ms-production-detail-button';
       button.textContent='Проверить учётные остатки';
       button.addEventListener('click',()=>precheck(order,button));
       td.append(button);
     }
     tbody.append(tr);
   }
   table.hidden=!matching.length;
   if(bucketSummary)bucketSummary.textContent='В показанной выборке: активные '+counts.active+
     ' · доставка '+counts.transit+' · история '+counts.history+
     ' · уточнение '+counts.review+'. Выбрано: '+matching.length+'.';
   const sc=data.sources.map(x=>x.source+': '+x.rows_seen+' ('+x.coverage+')').join(' · ');
   status.textContent='В D1 показано '+data.orders.length+
     ' заказов (не более 150), сохранённые источники: '+sc+
     '. Категории отражают только статус источника; готовность, склад и отгрузка не подтверждены.';
 }
 if(bucketSelect)bucketSelect.addEventListener('change',()=>{if(latest)render(latest);});
 async function precheck(order,button){
   if(working)return;
   working=true;button.disabled=true;
   precheckStatus.textContent='Проверяем товар и отчёт МойСклад для заказа '+order.external_id+'…';
   try{
     const r=await fetch('/api/orders/order-stock-precheck',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'Content-Type':'application/json',Accept:'application/json'},
       body:JSON.stringify({orderKey:order.order_key}),
       signal:AbortSignal.timeout(110000)});
     const data=await r.json();
     if(!r.ok||data?.code!=='order_stock_precheck'||!Array.isArray(data.rows))
       throw Error(data?.code||'precheck_unavailable');
     const notes=data.rows.map(item=>{
       const status=item.itemId?
         (item.stockEvidence==='report_by_store'?
           'учётные остатки по складам получены, склад заказа не подтверждён':
           'сведения об остатке не подтверждены'):
         'нет утверждённого соответствия SKU';
       const stores=(item.stores||[]).map(s=>s.store+': '+
         s.accountingStock+' учётно, '+s.reserve+' резерв').join(', ');
       return item.item+' × '+item.ordered+' — '+status+
         (stores?'; '+stores:'');
     });
     precheckStatus.textContent='Заказ '+order.external_id+': '+notes.join(' | ')+
       '. Потребность в пошиве и доступность к отбору НЕ подтверждены. Документы не изменены.';
   }catch(e){
     precheckStatus.textContent='Проверка не завершена: '+String(e.message).slice(0,110)+
       '. Заказ не распределён в пошив.';
   }finally{working=false;button.disabled=false;}
 }
 async function loadWorkflow(){
   const r=await fetch(workflowEndpoint,{credentials:'same-origin',cache:'no-store',
     headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   const data=await r.json();
   if(!r.ok||data?.code!=='order_workflow_review_read'||
      !Array.isArray(data.rows)||!Array.isArray(data.events))
     throw Error(data?.code||'workflow_unavailable');
   workflowByKey.clear();
   for(const row of data.rows)if(typeof row.order_key==='string')
     workflowByKey.set(row.order_key,row);
   workflowReady=true;
   const recent=data.events.slice(0,3).map(e=>
     (e.order_key||'заказ')+': '+(e.from_state||'первое действие')+' → '+e.to_state).join(' · ');
   workflowStatus.textContent='Предварительных действий по заказам: '+data.events.length+
     ' (последние 150). '+(recent||'Действий пока нет.')+
     ' Склад, производство и отгрузки не меняются.';
 }
 async function transition(order,entry,action,button){
   if(working||!workflowReady)return;
   if(!confirm('Сохранить этап рассмотрения заказа '+order.external_id+
     '? Это не производственное задание и не движение товара.'))return;
   working=true;button.disabled=true;
   try{
     const r=await fetch(workflowEndpoint,{method:'POST',credentials:'same-origin',
       cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},
       body:JSON.stringify({orderKey:order.order_key,action,
         expectedRevision:entry?.revision||0}),signal:AbortSignal.timeout(20000)});
     const data=await r.json();
     if(!r.ok||data?.code!=='workflow_review_saved')
       throw Error(data?.code||'review_not_saved');
     await loadWorkflow();
     if(latest)render(latest);
   }catch(e){
     workflowStatus.textContent='Этап не сохранён: '+String(e.message).slice(0,100);
   }finally{working=false;button.disabled=false;}
 }
 async function reload(){
   const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',
     headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   const data=await r.json();
   if(!r.ok||data?.code!=='persistent_queue_read'||!Array.isArray(data.orders)||
      !Array.isArray(data.sources))throw Error(data?.code||'queue_unavailable');
   try{await loadWorkflow();}catch(e){
     workflowReady=false;
     workflowStatus.textContent='Этапы рассмотрения пока недоступны: '+
       String(e.message).slice(0,100)+'. Необходимо применить миграцию D1.';
   }
   render(data);
 }
 refresh.addEventListener('click',async()=>{
   if(working)return;working=true;refresh.disabled=true;sync.disabled=true;
   try{await reload();}catch(e){
     status.textContent=e.message==='persistent_queue_storage_unavailable'?
      'Нужна миграция D1: 20261125_persistent_order_queue.sql. Записи не выполнялись.':
      'Сохранённая очередь недоступна: '+String(e.message).slice(0,80);
   }finally{working=false;refresh.disabled=false;sync.disabled=false;}
 });
 sync.addEventListener('click',async()=>{
   if(working)return;working=true;refresh.disabled=true;sync.disabled=true;
   let successes=0;const errors=[];
   try{
     for(const source of sources){
       status.textContent='Проверяем и сохраняем: '+source+' ('+(successes+errors.length+1)+'/5)…';
       try{
         const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',
           cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},
           body:JSON.stringify({source}),signal:AbortSignal.timeout(150000)});
         const data=await r.json();
         if(!r.ok||data?.code!=='persistent_queue_source_saved')
           throw Error(data?.code||'source_unavailable');
         successes++;
       }catch(e){
         errors.push(source+': '+String(e.message||'ошибка').slice(0,60));
       }
     }
     try{await reload();}catch(e){
       status.textContent='Успешных источников: '+successes+'/5; '+errors.join(' · ')+
        '. Чтение D1 не подтверждено: '+String(e.message).slice(0,65);
       return;
     }
     const summary=status.textContent;
     status.textContent='Источников успешно сохранено '+successes+'/5. '+
       (errors.length?'Ошибки: '+errors.join(' · ')+'. ':'')+summary;
   }finally{working=false;refresh.disabled=false;sync.disabled=false;}
 });
 // Reading the saved mirror is separate from live-source queries.
 if(location.hash.split('/')[0]==='#orders')refresh.click();
})();
