// Owner-only review of exact MoySklad warehouse and organization UUIDs.
(()=>{
 'use strict';
 const load=document.getElementById('warehouseRoutesLoad');
 if(!load)return;
 const form=document.getElementById('warehouseRoutesForm');
 const approve=document.getElementById('warehouseRoutesApprove');
 const status=document.getElementById('warehouseRoutesStatus');
 const account=document.getElementById('warehouseRoutesAccount');
 const store=document.getElementById('warehouseRoutesStore');
 const org=document.getElementById('warehouseRoutesOrganization');
 const kind=document.getElementById('warehouseRoutesKind');
 const endpoint='/api/orders/warehouse-route-approval';
 let busy=false,known=null;
 const fill=(select,items,getValue,getText)=>{
  select.replaceChildren(...items.map(x=>new Option(getText(x),getValue(x))));
 };
 async function refresh(){
  if(busy)return;
  busy=true;load.disabled=true;approve.disabled=true;
  status.textContent='Проверяем доступные кабинеты, склады и юрлица через МойСклад…';
  try{
   const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',
    headers:{Accept:'application/json'},signal:AbortSignal.timeout(60000)});
   const data=await r.json();
   if(!r.ok||data.code!=='warehouse_route_candidates'||
    !Array.isArray(data.accounts)||!Array.isArray(data.stores)||
    !Array.isArray(data.organizations)||!Array.isArray(data.routes))
    throw Error(data.code||'no_verified_choices');
   known=data;
   const existing=new Set(data.routes.map(x=>x.source+'|'+x.seller_account));
   const options=data.accounts.filter(x=>!existing.has(x.source+'|'+x.account));
   fill(account,options,x=>x.source+'|'+x.account,x=>x.source+' · '+x.account);
   fill(store,data.stores,x=>x.id,x=>x.name+' · '+x.id);
   fill(org,data.organizations,x=>x.id,x=>x.name+' · '+x.id);
   form.hidden=!options.length||!data.stores.length||!data.organizations.length;
   status.textContent='Неподтверждённых кабинетов: '+options.length+
    '. Уже утверждено: '+data.routes.length+
    '. Склад и юрлицо нужно выбирать по фактической схеме исполнения, а не только по названию.';
  }catch(e){
   known=null;form.hidden=true;
   status.textContent='Подтверждение пока недоступно: '+String(e.message).slice(0,100);
  }finally{busy=false;load.disabled=false;approve.disabled=false;}
 }
 load.addEventListener('click',refresh);
 approve.addEventListener('click',async()=>{
  if(busy||!known||form.hidden)return;
  const [source,sellerAccount]=account.value.split('|');
  const storeId=store.value,organizationId=org.value,storeKind=kind.value;
  const storeName=known.stores.find(x=>x.id===storeId)?.name;
  const orgName=known.organizations.find(x=>x.id===organizationId)?.name;
  if(!source||!sellerAccount||!storeName||!orgName)return;
  if(!confirm('Подтвердить кабинет '+source+' '+sellerAccount+
   '\nСклад: '+storeName+'\nЮрлицо: '+orgName+
   '\nНазначение: '+kind.selectedOptions[0]?.textContent+
   '\nПодтверждение сохранится в D1. Убедитесь, что это фактический склад исполнения.'))return;
  busy=true;approve.disabled=true;load.disabled=true;
  try{
   const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',
    cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({source,sellerAccount,storeId,organizationId,storeKind}),
    signal:AbortSignal.timeout(40000)});
   const data=await r.json();
   if(!r.ok||data.code!=='warehouse_route_approved')
    throw Error(data.code||'approval_not_saved');
   status.textContent='Подтверждена связь '+source+' '+sellerAccount+
    ' → '+storeName+' / '+orgName+'. МойСклад не изменён.';
   form.hidden=true;known=null;
  }catch(e){
   status.textContent='Связь НЕ сохранена: '+String(e.message).slice(0,100);
  }finally{busy=false;approve.disabled=false;load.disabled=false;}
 });
})();
