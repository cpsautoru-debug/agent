const channelLabels={ozon:'Ozon',wb:'Wildberries',yandex:'Яндекс Маркет',avito:'Авито',plamya:'Пламя',dealer_ruslan:'Дилер Руслан',dealer_irina:'Дилер Ирина'};
const reasonLabels={awaiting_dispatch_no_sewing:'Ожидает отгрузки по данным площадки',needs_stock_and_sku_check:'Проверить товар и остаток',not_in_latest_source_snapshot:'Не найден в последнем снимке',source_snapshot_missing:'Нет актуального снимка',manual_status_requires_verification:'Проверить ручной заказ',payment_unverified:'Проверить оплату',fbo_no_direct_sewing:'FBO — без прямого пошива',unrecognized_source_status:'Уточнить статус'};
function displayOrder(key){const parts=typeof key==='string'?key.split(':'):[];return parts.length===4&&parts[0]==='AS63'?parts[3]:key;}
const role=document.getElementById('staffPreviewRole'),button=document.getElementById('staffPreviewRefresh'),status=document.getElementById('staffPreviewStatus'),rows=document.getElementById('staffPreviewRows');
if(role&&button&&status&&rows){
 let generation=0;
 const clear=()=>{generation++;rows.replaceChildren();button.disabled=false;status.textContent='Выберите «Показать» для загрузки рабочего места.';};
 role.addEventListener('change',clear);
 button.addEventListener('click',async()=>{
  const current=++generation,selected=role.value;
  rows.replaceChildren();button.disabled=true;status.textContent='Загрузка…';
  try{
   const response=await fetch('/api/orders/staff-preview?role='+encodeURIComponent(selected),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
   const data=await response.json();
   if(current!==generation)return;
   if(!response.ok||data.code!=='staff_preview'||data.role!==selected||data.ownerPreview!==true||data.readOnly!==true||!Array.isArray(data.rows)||data.approvedForDispatch!==false||data.approvedForProduction!==false)throw Error();
   for(const order of data.rows){
    for(const item of order.items||[order]){
     const tr=document.createElement('tr');
     const channel=order.source||order.orderKey?.split(':')[1];
     const reason=reasonLabels[order.reason]||(selected==='dispatch'?'Ожидает отгрузки по данным площадки':data.complete?'Предварительно проверено':'Требуется проверка');
     for(const [index,value] of [displayOrder(order.orderKey),channelLabels[channel]||channel,item.sku,item.quantity,reason].entries()){
      const td=document.createElement('td');td.textContent=String(value??'—');if(index===0)td.title=String(order.orderKey??'');tr.append(td);
     }
     rows.append(tr);
    }
   }
   status.textContent=(data.complete?'Предварительный просмотр. ':'Данные неполные или не подтверждены. ')+
    (data.rows.length?'Записей: '+data.rows.length+'. ':'Нет записей для показа. ')+
    'Не является заданием на производство или разрешением отгрузки.';
  }catch{if(current===generation){rows.replaceChildren();status.textContent='Рабочее место недоступно. Проверьте вход владельца.';}}
  finally{if(current===generation)button.disabled=false;}
 });
 window.addEventListener('hashchange',clear);
}
