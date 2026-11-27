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
     for(const value of [order.orderKey,order.source,item.sku,item.quantity]){
      const td=document.createElement('td');td.textContent=String(value??'—');tr.append(td);
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
