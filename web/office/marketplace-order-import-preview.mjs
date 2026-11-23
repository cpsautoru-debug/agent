// Explicit owner-triggered DRY RUN. No marketplace or MoySklad writes.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const ozon=el('marketplaceOrderCheckOzon'),wb=el('marketplaceOrderCheckWb');
  const status=el('marketplaceOrderCheckStatus'),table=el('marketplaceOrderCheckTable');
  const rows=el('marketplaceOrderCheckRows');
  if(!ozon||!wb||!status||!table||!rows)return;
  let busy=false;
  const valid=d=>d?.code==='marketplace_order_import_preview_ok'&&
    ['ozon','wb'].includes(d.source)&&d.readOnly===true&&
    d.changedRecords===0&&d.approvedForWrite===false&&
    d.coverage==='FBS_FIRST_PAGE_ONLY_NOT_ALL_MARKETPLACE_ORDERS'&&
    Array.isArray(d.orders)&&d.orders.length<=10&&
    Number.isSafeInteger(d.counts?.received)&&
    d.counts.received===d.orders.length&&
    d.orders.every(x=>x.source===d.source&&
      x.readyToWrite===false&&x.assortmentVerified===false&&
      x.legalEntityVerified===false&&
      typeof x.externalKey==='string'&&x.externalKey.startsWith('AS63:')&&
      Array.isArray(x.items)&&x.items.every(p=>
        typeof p.sku==='string'&&Number.isSafeInteger(p.quantity)&&
        p.quantity>0)&&
      ['already_exists','not_found','unverified'].includes(x.duplicateStatus));
  const cell=(tr,value)=>{const td=document.createElement('td');
    td.textContent=value;tr.append(td);};
  async function load(source){
    if(busy)return;
    busy=true;ozon.disabled=true;wb.disabled=true;rows.replaceChildren();
    table.hidden=true;
    status.textContent='Проверяем '+(source==='ozon'?'Ozon':'Wildberries')+
      ' и наличие совпадений в «МойСклад»…';
    try{
      const res=await fetch('/api/marketplace/order-import-preview?source='+source,{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(150000)});
      const data=await res.json();
      if(!res.ok||!valid(data))throw Error(data?.code||'preview_unverified');
      for(const order of data.orders){
        const tr=document.createElement('tr');
        cell(tr,order.externalKey);
        cell(tr,order.status);
        cell(tr,order.items.map(p=>p.sku+' × '+p.quantity).join('; '));
        cell(tr,order.duplicateStatus==='already_exists'?'Уже существует':
          order.duplicateStatus==='not_found'?'Не найден · создание запрещено':
          'Не подтверждено');
        rows.append(tr);
      }
      table.hidden=!data.orders.length;
      status.textContent='Проверка выполнена: '+data.counts.received+
        ' заказов в ограниченной выборке. В «МойСклад» уже есть: '+
        data.counts.existing+', не найдены: '+data.counts.notFound+
        ', не подтверждены: '+data.counts.uncertain+
        '. Документы не созданы, ассортимент и юридические лица не сверены.';
    }catch{
      status.textContent='Данные заказа или проверка дублей сейчас недоступны. '+
        'Импорт не выполнялся; проверьте права API и формат ответа.';
    }finally{busy=false;ozon.disabled=false;wb.disabled=false;}
  }
  ozon.addEventListener('click',()=>void load('ozon'));
  wb.addEventListener('click',()=>void load('wb'));
})();
