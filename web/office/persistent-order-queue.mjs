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
 const fulfillmentTable=document.getElementById('orderFulfillmentTable');
 const fulfillmentRows=document.getElementById('orderFulfillmentRows');
 const fulfillmentSummary=document.getElementById('orderFulfillmentSummary');
 const channelFilter=document.getElementById('orderFulfillmentChannel');
 const warehouseFilter=document.getElementById('orderFulfillmentWarehouse');
 const modelFilter=document.getElementById('orderFulfillmentModel');
 const reasons={
   item_mapping_unverified:'Связь SKU не подтверждена',
   warehouse_unverified:'Склад исполнения не подтверждён',
   availability_unverified:'Остаток или резерв не подтверждён',
   production_unverified:'Требуется сверка производства',
   competing_order_coverage_unverified:'Охват конкурирующих заказов не подтверждён',
   marketplace_coverage_unverified:'Охват обязательств маркетплейсов не подтверждён'
 };
 function renderFulfillment(data){
   if(!fulfillmentTable)return;
   const active=data.orders.filter(order=>order.queue_bucket==='active');
   const checks=new Map((data.fulfillment||[]).map(check=>[check.orderKey,check]));
   const readiness=new Map((data.approvalReadiness||[]).map(x=>[x.orderKey,x]));
   const entries=active.flatMap(order=>{
     const check=checks.get(order.order_key);
     return (check?.lines||order.items.map(i=>({item:i.name||i.sku||i.itemId,
       ordered:i.quantity}))).map(line=>({order,line,check,store:check?.warehouse?.storeName||'Не подтверждён'}));
   });
   for(const [select,values] of [
     [channelFilter,entries.map(e=>e.order.source)],[warehouseFilter,entries.map(e=>e.store)]
   ]){
     const selected=select.value;
     select.replaceChildren(new Option('Все',''),...[...new Set(values)].sort()
       .map(value=>new Option(value,value)));
     select.value=values.includes(selected)?selected:'';
   }
   fulfillmentRows.replaceChildren();
   for(const {order,line,check,store} of entries){
     if(channelFilter.value&&channelFilter.value!==order.source||
        warehouseFilter.value&&warehouseFilter.value!==store||
        !String(line.item).toLowerCase().includes(modelFilter.value.trim().toLowerCase()))continue;
     const tr=document.createElement('tr');
     for(const value of [order.external_id,order.source,line.item,store,line.ordered,
        line.accounting?.stock,line.accounting?.reserve,line.occupancy?.warehouseAdditional,
        line.warehouseCovered])cell(tr,value);
     const jobs=document.createElement('td');
     for(const job of line.production?.jobs||[]){
       const a=document.createElement('a');
       a.href='https://online.moysklad.ru/app/#productiontask/edit?id='+encodeURIComponent(job.id);
       a.textContent='План '+job.pending+' · выполнено '+job.completed+
         (job.due?' · '+new Date(job.due).toLocaleDateString('ru-RU',{timeZone:'Europe/Samara'}):'');
       jobs.append(a,document.createElement('br'));
     }
     if(!jobs.childNodes.length)jobs.textContent='—';
     tr.append(jobs);
     cell(tr,line.plannedCovered);
     cell(tr,line.missing);
     cell(tr,check?.checkedAt?new Date(check.checkedAt).toLocaleString('ru-RU',{timeZone:'Europe/Samara'}):null);
     let statusLabel=line.status==='sewing_required'
       ?'Требуется пошив · '+line.missing+' шт.'
       :line.status==='production_covered'?'Покрыто существующим производством'
       :line.status==='warehouse_covered'?'Учётно обеспечено складом'
       :'Требует уточнения · '+(reasons[line.reason]||'Нет актуального расчёта');
     const approval=readiness.get(order.order_key);
     if(line.status!=='sewing_required'&&line.status!=='production_covered'&&
        line.status!=='warehouse_covered'&&approval){
       const issues=[];
       if(!approval.warehouseConfirmed)issues.push('подтвердить склад кабинета');
       if(approval.unapprovedSkus?.length)
         issues.push('подтвердить SKU: '+approval.unapprovedSkus.slice(0,3).join(', '));
       if(issues.length)statusLabel+=' · '+issues.join('; ');
     }
     cell(tr,statusLabel);
     if(approval&&!['sewing_required','production_covered','warehouse_covered'].includes(line.status)){
       const actionCell=document.createElement('span');
       const addAction=(label,event,detail)=>{
         const button=document.createElement('button');
         button.type='button';
         button.className='ms-production-detail-button';
         button.textContent=label;
         button.addEventListener('click',()=>{
           document.dispatchEvent(new CustomEvent(event,{detail}));
         });
         actionCell.append(button);
       };
       if(approval.unapprovedSkus?.length)
         addAction('Подтвердить SKU','as63:focus-sku',{
           source:order.source,sellerAccount:order.account,sku:approval.unapprovedSkus[0]
         });
       if(!approval.warehouseConfirmed&&['ozon','wb','yandex'].includes(order.source))
         addAction('Подтвердить склад','as63:focus-route',{
           source:order.source,account:order.account
         });
       const statusCell=tr.lastElementChild;
       if(statusCell&&actionCell.childNodes.length)statusCell.append(actionCell);
     }
     fulfillmentRows.append(tr);
   }
   fulfillmentTable.hidden=!fulfillmentRows.childNodes.length;
   const confirmed=entries.filter(e=>['sewing_required','production_covered',
     'warehouse_covered'].includes(e.line.status));
   const pending=entries.length-confirmed.length;
   const sewing=confirmed.reduce((n,e)=>n+(e.line.missing||0),0);
   fulfillmentSummary.textContent='Активных заказов в выборке: '+active.length+
     ' · Подтверждённых позиций: '+confirmed.length+
     ' · Требуют уточнения: '+pending+
     ' · Подтверждённая потребность: '+(confirmed.length?sewing+' шт.':'—')+
     ' (только подтверждённые позиции)'+
     (checks.size&&[...checks.values()].some(c=>c.sourceCoverage?.complete===false)?
       ' · Охват всех открытых обязательств маркетплейсов НЕ подтверждён.':'')+
     (data.fulfillmentAvailable?'':'. Сохранённые проверки недоступны.');
 }
 for(const filter of [channelFilter,warehouseFilter,modelFilter]){
   filter?.addEventListener('input',()=>{if(latest)renderFulfillment(latest);});
 }
 function render(data){
   latest=data;
   renderFulfillment(data);
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
     if(order.queue_bucket==='active'||(order.queue_bucket==='review'&&
        order.ms_customerorder_id&&order.production_disposition!=='not_for_sewing')){
       const button=document.createElement('button');
       button.type='button';button.className='ms-production-detail-button';
       button.textContent=order.queue_bucket==='active'?'Проверить обеспеченность':'Проверить склад исполнения';
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
           'учётный остаток и резерв на складе получены':
           'сведения об остатке не подтверждены'):
         'нет утверждённого соответствия SKU';
       const stores=(item.stores||[]).map(s=>s.store+': '+
         s.accountingStock+' учётно, '+s.reserve+' резерв').join(', ');
       return item.item+' × '+item.ordered+' — '+status+
         (stores?'; '+stores:'');
     });
     const warehouse=data.warehouse;
     const warehouseText=warehouse?.status==='warehouse_verified'
       ? [warehouse.organizationName,warehouse.storeName,
          warehouse.source==='customerorder'?'Заказ покупателя МойСклад':'Привязка кабинета',
          new Date(warehouse.checkedAt).toLocaleString('ru-RU',{timeZone:'Europe/Samara'})].join(' · ')
       : 'Склад не прошёл серверную проверку ('+(warehouse?.reason||'причина не установлена')+
         '). Подтверждённую связь кабинета повторно сохранять не нужно.';
     const coverageNote=data.sourceCoverage?.complete===false?
       ' · Охват обязательств: '+(data.sourceCoverage.sources||[])
         .filter(x=>!x.ready).map(x=>x.source+' ('+x.reason+')').join(', '):'';
     precheckStatus.textContent='Заказ '+order.external_id+' · '+order.source+' · '+warehouseText+
       ' | '+notes.join(' | ')+coverageNote+
       '. Потребность в пошиве и доступность к отбору НЕ подтверждены. Документы не изменены.';
     if(data.reviewStored)await reload(false);
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
 async function reload(includeWorkflow=true){
   const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',
     headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   const data=await r.json();
   if(!r.ok||data?.code!=='persistent_queue_read'||!Array.isArray(data.orders)||
      !Array.isArray(data.sources))throw Error(data?.code||'queue_unavailable');
   if(includeWorkflow)try{await loadWorkflow();}catch(e){
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
         if(!r.ok||!['persistent_queue_source_saved','persistent_queue_source_reused'].includes(data?.code))
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
