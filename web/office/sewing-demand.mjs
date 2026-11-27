const status=document.getElementById('sewingDemandStatus'),rows=document.getElementById('sewingDemandRows'),button=document.getElementById('sewingDemandRefresh');
if(status&&rows&&button){
 const labels={stock:'Из наличия',production:'Уже в производстве',sewing:'В пошив',review:'Требует уточнения'};
 let busy=false,last=0;
 async function load(){
  if(busy)return;busy=true;last=Date.now();button.disabled=true;rows.replaceChildren();status.textContent='Загрузка…';
  try{
   const r=await fetch('/api/orders/persistent-queue',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error();
   const d=(await r.json()).demand;
   if(d?.readOnly!==true||d.approvedForDispatch!==false||!Array.isArray(d.rows))throw Error();
   status.textContent=(d.complete?'Проверенная выборка. ':'Данные неполные. Не является заданием на пошив. ')+
    'Из наличия: '+d.counts.stock+'; уже в производстве: '+d.counts.production+'; в пошив: '+d.counts.sewing+'; требует уточнения (строк): '+d.counts.review+'. Порядок по категориям, сроки отгрузки не подтверждены. Показана ограниченная выборка заказов.';
   for(const x of d.rows){
    const tr=document.createElement('tr');
    for(const value of [x.orderKey,x.sku,(x.priority?x.priority+'. ':'')+(labels[x.category]||labels.review),x.quantity??'Н/Д']){
     const td=document.createElement('td');td.textContent=String(value??'Н/Д');tr.append(td);
    }
    rows.append(tr);
   }
  }catch{status.textContent='Очередь недоступна. Потребность не подтверждена.';}
  finally{busy=false;button.disabled=false;}
 }
 button.addEventListener('click',load);
 function maybe(){if(document.visibilityState==='visible'&&location.hash.split('/')[0]==='#production'&&Date.now()-last>=5*60000)void load();}
 window.addEventListener('hashchange',maybe);document.addEventListener('visibilitychange',maybe);setInterval(maybe,60000);maybe();
}
