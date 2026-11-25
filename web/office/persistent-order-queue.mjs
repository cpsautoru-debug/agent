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
   bucketSummary=document.getElementById('persistentOrdersBucketCounts');
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
 async function reload(){
   const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',
     headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   const data=await r.json();
   if(!r.ok||data?.code!=='persistent_queue_read'||!Array.isArray(data.orders)||
      !Array.isArray(data.sources))throw Error(data?.code||'queue_unavailable');
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
