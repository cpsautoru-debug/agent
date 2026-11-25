// Explicit owner-reviewed SKU mapping from saved D1 orders.
// Never approves name-only candidates or modifies MoySklad.
(()=>{
 'use strict';
 const load=document.getElementById('savedSkuMatchLoad');
 if(!load)return;
 const select=document.getElementById('savedSkuMatchSelect');
 const check=document.getElementById('savedSkuMatchCheck');
 const status=document.getElementById('savedSkuMatchStatus');
 const candidateArea=document.getElementById('savedSkuMatchCandidate');
 const entries=new Map();
 let approved=new Set(),busy=false;
 const key=x=>[x.source,x.sellerAccount,x.sku].join('|');
 async function json(url,options={}){
   const r=await fetch(url,{credentials:'same-origin',cache:'no-store',
    headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})},
    signal:AbortSignal.timeout(90000),...options});
   const data=await r.json();
   if(!r.ok)throw Error(data?.code||'source_unavailable');
   return data;
 }
 async function loadSaved(target=null){
  if(busy)return;
  busy=true;load.disabled=true;check.disabled=true;candidateArea.replaceChildren();
  try{
   const [queue,links]=await Promise.all([
    json('/api/orders/persistent-queue'),json('/api/ms/order-sku-links')
   ]);
   if(queue.code!=='persistent_queue_read'||links.code!=='sku_links_read'||
    !Array.isArray(queue.orders)||!Array.isArray(links.approvedLinks))throw Error('data_unverified');
   entries.clear();
   approved=new Set(links.approvedLinks.map(x=>
    [x.source,x.seller_account,x.marketplace_sku].join('|')));
   for(const order of queue.orders){
    if(!['ozon','ozon_fbo','wb','yandex'].includes(order.source))continue;
    for(const item of order.items||[]){
     if(typeof item.sku!=='string'||!item.sku||item.sku.length>100)continue;
     const x={source:order.source,sellerAccount:order.account,sku:item.sku};
     if(!approved.has(key(x)))entries.set(key(x),x);
    }
   }
   select.replaceChildren(...[...entries.values()].map(x=>
    new Option(x.source+' · '+x.sellerAccount+' · '+x.sku,key(x))));
   check.disabled=!entries.size;
   if(target&&entries.has(target))select.value=target;
   else if(target&&approved.has(target))
    status.textContent='Этот SKU уже подтверждён.';
   status.textContent='Неутверждённых SKU в показанных сохранённых заказах: '+
    entries.size+'. Выберите SKU и выполните точную проверку в МойСклад. '+
    'Отсутствие совпадения по артикулу или коду не означает отсутствие товара.';
  }catch(e){
   status.textContent='Не удалось загрузить SKU: '+String(e.message).slice(0,110);
  }finally{busy=false;load.disabled=false;}
 }
 function showManualCandidates(entry,candidates){
   const list=candidates.filter(c=>c&&
     /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id||'')&&
     ['product','variant','bundle'].includes(c.type)&&
     typeof c.name==='string'&&c.name.trim().length>0).slice(0,3);
   if(!list.length)return false;
   const explanation=document.createElement('p');
   explanation.textContent='Возможные товары МойСклад (найдены по названию, НЕ по артикулу). '+
     'Это только варианты для ручной сверки модели, цвета и комплектации. Ни один не выбран автоматически.';
   candidateArea.append(explanation);
   for(const item of list){
     const div=document.createElement('div');
     const p=document.createElement('p');
     p.textContent=item.name+' · '+item.type+' · UUID '+item.id;
     const button=document.createElement('button');button.type='button';
     button.className='ms-production-detail-button';
     button.textContent='Подтвердить после сверки карточки';
     button.addEventListener('click',async()=>{
       if(busy||approved.has(key(entry)))return;
       if(!confirm('Проверьте соответствие товара в МойСклад.\n'+
        'SKU маркетплейса: '+entry.sku+'\nВариант МойСклад: '+item.name+
        '\nUUID: '+item.id+'\n'+
        'Подтверждаете ИМЕННО эту модель, цвет, комплектацию и посадку?'))return;
       busy=true;button.disabled=true;check.disabled=true;
       try{
         const data=await json('/api/ms/order-sku-links',{method:'POST',
           body:JSON.stringify({...entry,itemId:item.id,itemType:item.type})});
         if(data.code!=='sku_link_approved'||data.itemId!==item.id.toLowerCase())
           throw Error('approval_not_verified');
         approved.add(key(entry));entries.delete(key(entry));
         candidateArea.replaceChildren();
         status.textContent='Утверждённая владельцем связь: '+entry.sku+
           ' → '+data.itemName+'. UUID повторно проверен сервером в МойСклад. '+
           'Заказы, остатки и производство не изменены.';
       }catch(e){
         status.textContent='Связь не сохранена: '+String(e.message).slice(0,100);
       }finally{busy=false;button.disabled=false;check.disabled=false;}
     });
     div.append(p,button);candidateArea.append(div);
   }
   return true;
 }
 async function inspect(){
  if(busy)return;
  const entry=entries.get(select.value);if(!entry)return;
  busy=true;check.disabled=true;candidateArea.replaceChildren();
  status.textContent='Сверяем артикул и код '+entry.sku+' с МойСклад…';
  try{
   const result=await json('/api/ms/orders-stock-match',{method:'POST',
    body:JSON.stringify({entries:[entry]})});
   if(result.code!=='ms_orders_stock_match'||result.readOnly!==true||
    !Array.isArray(result.matches)||result.matches.length!==1)
    throw Error('incomplete_lookup');
   const found=result.matches[0];
   if(approved.has(key(entry))){
    status.textContent='SKU уже утверждён. Обновите список.';return;
   }
   if(found.status!=='matched_stock_report'&&found.status!=='matched_stock_unknown'){
    const hasCandidates=showManualCandidates(entry,Array.isArray(found.possibleNameCandidates)?
       found.possibleNameCandidates:[]);
    status.textContent='Точного совпадения артикула/кода нет ('+
      (found.reason||found.status)+'). '+
      (hasCandidates?'Показаны варианты по названию для РУЧНОЙ проверки.':
       'Подтверждённых кандидатов по названию также нет. Нужна карточка товара МойСклад.')+
      ' Пока связь не утверждена, расчёт пошива заблокирован.';
    return;
   }
   if(found.candidates!==1||!['product','variant','bundle'].includes(found.itemType)||
    !/^[0-9a-f-]{36}$/i.test(found.itemId||'')||
    !Array.isArray(found.matchFields)||!found.matchFields.some(x=>x==='article'||x==='code')){
    status.textContent='Нет однозначного соответствия по артикулу/коду. Запись запрещена.';
    return;
   }
   const p=document.createElement('p');
   p.textContent='Найдено точное совпадение: '+(found.itemName||'Без имени')+
    ' · '+found.itemType+' · '+found.itemId+' · совпало поле: '+
    found.matchFields.join(', ')+'. Проверьте модель, цвет, комплектацию.';
   const button=document.createElement('button');
   button.type='button';button.className='ms-production-detail-button';
   button.textContent='Подтвердить эту карточку товара';
   button.addEventListener('click',async()=>{
    if(busy||!confirm('Подтверждаете, что SKU '+entry.sku+
      ' в кабинете '+entry.sellerAccount+' — это именно '+(found.itemName||found.itemId)+
      '?\nUUID: '+found.itemId+'\nСвязь сохраняется только в D1.'))return;
    busy=true;button.disabled=true;check.disabled=true;
    try{
     const data=await json('/api/ms/order-sku-links',{method:'POST',
      body:JSON.stringify({...entry,itemId:found.itemId,itemType:found.itemType})});
     if(data.code!=='sku_link_approved')throw Error('link_not_confirmed');
     approved.add(key(entry));entries.delete(key(entry));
     candidateArea.replaceChildren();
     status.textContent='Подтверждена связь '+entry.sku+' → '+found.itemName+
       '. Изменений в МойСклад нет. Обновите список SKU.';
    }catch(e){status.textContent='Связь не сохранена: '+String(e.message).slice(0,100);}
    finally{busy=false;button.disabled=false;check.disabled=false;}
   });
   candidateArea.append(p,button);
   status.textContent='Карточка найдена по точному совпадению. Требуется подтверждение владельца.';
  }catch(e){
   status.textContent='Сверка SKU не завершена: '+String(e.message).slice(0,110);
  }finally{busy=false;check.disabled=false;}
 }
 document.addEventListener('as63:focus-sku',event=>{
   const entry=event.detail;
   if(!entry||!['ozon','ozon_fbo','wb','yandex'].includes(entry.source)||
      typeof entry.sellerAccount!=='string'||typeof entry.sku!=='string')return;
   load.scrollIntoView({behavior:'smooth',block:'center'});
   loadSaved(key(entry));
 });
 load.addEventListener('click',()=>loadSaved());
 check.addEventListener('click',inspect);
 select.addEventListener('change',()=>candidateArea.replaceChildren());
})();
