const status=document.getElementById('sewingDemandStatus'),rows=document.getElementById('sewingDemandRows'),button=document.getElementById('sewingDemandRefresh');
if(status&&rows&&button){
 const labels={stock:'Из наличия',production:'Уже в производстве',sewing:'В пошив',review:'Требует уточнения'};
 const pickStatus=document.getElementById('pickingStatus'),pickRows=document.getElementById('pickingRows'),print=document.getElementById('pickingPrint');
 let picking=null;
 function showPicking(p){
  picking=null;if(!pickStatus||!pickRows||!print)return;
  pickRows.replaceChildren();print.disabled=true;
  pickStatus.textContent='Подбор не подтверждён. Н/Д.';
  if(p?.complete!==true||p.readOnly!==true||p.approvedForDispatch!==false||!Array.isArray(p.orders))return;
  picking=p;
  pickStatus.textContent='Предварительно: '+p.orders.length+' заказов, '+p.units+' комплектов. Не разрешение на отгрузку.';
  for(const o of p.orders)for(const item of o.items){const tr=document.createElement('tr');for(const v of [o.orderKey,item.sku,item.quantity]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}pickRows.append(tr);}
  print.disabled=!p.orders.length;
 }
 if(print)print.addEventListener('click',()=>{
  if(!picking||busy||Date.now()-last>5*60000)return;
  const page=window.open('','_blank');if(!page)return;
  const doc=page.document;doc.title='Предварительный лист подбора';
  const heading=doc.createElement('h1');heading.textContent='Предварительный лист подбора — не разрешение на отгрузку';doc.body.append(heading);
  const stamp=doc.createElement('p');stamp.textContent='Снимок: '+new Date(last).toLocaleString('ru-RU',{timeZone:'Europe/Samara'});doc.body.append(stamp);
  for(const o of picking.orders)for(const item of o.items){const line=doc.createElement('p');line.textContent=o.orderKey+' | '+item.sku+' | '+item.quantity;doc.body.append(line);}
  page.opener=null;page.print();
 });
 let busy=false,last=0,filter='all',data=null;
 const filters=[...document.querySelectorAll('#sewingDemand [data-demand-filter]')];
 function render(){
 rows.replaceChildren();
 if(!data)return;
 const selected=data.rows.filter(x=>filter==='all'||x.category===filter);
 for(const x of selected){
 const tr=document.createElement('tr');
 for(const value of [x.orderKey,x.sku,(x.priority?x.priority+'. ':'')+(labels[x.category]||labels.review),x.quantity??'Н/Д']){const td=document.createElement('td');td.textContent=String(value??'Н/Д');tr.append(td);}
 rows.append(tr);
 }
 if(!selected.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent=data.complete?'Нет строк в выбранной категории.':'Нет подтверждённых строк в выбранной категории. Данные неполные.';tr.append(td);rows.append(tr);}
 }
 for(const f of filters)f.addEventListener('click',()=>{filter=f.dataset.demandFilter;for(const b of filters)b.setAttribute('aria-pressed',String(b===f));render();});
 async function load(){
  if(busy)return;busy=true;last=Date.now();button.disabled=true;data=null;showPicking(null);rows.replaceChildren();status.textContent='Загрузка…';
  try{
   const r=await fetch('/api/orders/persistent-queue',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error();
   const payload=await r.json();const d=payload.demand;
   if(d?.readOnly!==true||d.approvedForDispatch!==false||!Array.isArray(d.rows))throw Error();
   status.textContent=(d.complete?'Проверенная выборка. ':'Данные неполные. Не является заданием на пошив. ')+
    'Из наличия: '+d.counts.stock+'; уже в производстве: '+d.counts.production+'; в пошив: '+d.counts.sewing+'; требует уточнения (строк): '+d.counts.review+'. Порядок по категориям, сроки отгрузки не подтверждены. Показана ограниченная выборка заказов.';
   data=d;render();showPicking(payload.picking);
  }catch{showPicking(null);status.textContent='Очередь недоступна. Потребность не подтверждена.';}
  finally{busy=false;button.disabled=false;}
 }
 button.addEventListener('click',load);
 function maybe(){if(document.visibilityState==='visible'&&location.hash.split('/')[0]==='#production'&&Date.now()-last>=5*60000)void load();}
 window.addEventListener('hashchange',maybe);document.addEventListener('visibilitychange',maybe);setInterval(maybe,60000);maybe();
}
