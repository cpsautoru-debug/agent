// Owner-triggered, read-only stock and movement reconciliation.
// The reports are non-atomic; no recommendation writes to MoySklad.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const button=el('msNegativeRefresh'),status=el('msNegativeStatus'),
    table=el('msNegativeTable'),rows=el('msNegativeRows');
  if(!button||!status||!table||!rows)return;
  const fmt=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3});
  let busy=false;
  const visible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const cell=(tr,value,className)=>{
    const td=document.createElement('td');
    td.textContent=String(value??'Неизвестно');
    if(className)td.className=className;
    tr.append(td);return td;
  };
  const addMovementLedger=(host,item)=>{
    if(!Array.isArray(item.documents))return;
    const details=document.createElement('details');
    const summary=document.createElement('summary');
    summary.textContent='Полный журнал · '+fmt.format(item.documentCount)+' строк';
    details.append(summary);
    const wrap=document.createElement('div');
    wrap.className='ms-production-scroll';
    const ledger=document.createElement('table');
    ledger.className='ms-production-table';
    const thead=document.createElement('thead'),head=document.createElement('tr');
    for(const label of ['Дата','Тип','Документ','Склад','Количество'])cell(head,label);
    thead.append(head);ledger.append(thead);
    const body=document.createElement('tbody');
    for(const movement of item.documents){
      const tr=document.createElement('tr');
      cell(tr,movement.date||'Дата не передана');
      cell(tr,movement.categoryLabel||'Тип не определён');
      cell(tr,movement.documentNumber||'Номер не передан');
      cell(tr,movement.warehouse||'Склад не передан');
      cell(tr,(typeof movement.quantity==='number'?fmt.format(movement.quantity):'Неизвестно')+
        ' '+(movement.unit||'ед. не указана'));
      body.append(tr);
    }
    ledger.append(body);wrap.append(ledger);details.append(wrap);host.append(details);
  };
  const causeSummary=item=>{
    if(item?.complete!==true||!item.countByCategory)return 'Полный журнал не получен.';
    const pairs=Object.entries(item.countByCategory);
    if(!pairs.length)return 'За указанный период движений не найдено.';
    return pairs.map(([category,count])=>
      (item.documents.find(x=>x.category===category)?.categoryLabel||category)+': '+fmt.format(count)
    ).join('; ');
  };
  const render=(snapshot,audit)=>{
    const byId=new Map((audit.results||[]).map(item=>[item.id,item]));
    rows.replaceChildren();
    for(const item of snapshot.items){
      const tr=document.createElement('tr');
      const movement=byId.get(item.id);
      cell(tr,(item.itemName||'Название не получено')+
        (item.itemCode?' · '+item.itemCode:'')+
        (item.unit?' · '+item.unit:' · ед. не указана'));
      cell(tr,item.warehouse||'Склад не указан');
      cell(tr,(typeof item.stock==='number'?fmt.format(item.stock):'Неизвестно')+
        ' '+(item.unit||'ед. не указана'));
      const evidence=cell(tr,'','ms-negative-evidence');
      evidence.textContent=movement?causeSummary(movement):
        'История для этой позиции не загружалась.';
      if(movement?.complete===true){
        const caution=document.createElement('p');
        caution.textContent='Это перечень документных количеств, не доказательство причины минуса. Перемещения требуют сверки направления.';
        evidence.append(caution);
        addMovementLedger(evidence,movement);
      }
      cell(tr,'Не проверено: нет подтверждённой связи позиции с действующей техкартой и её версией. Норма 5 м/комплект не подтверждена.');
      cell(tr,'Нужны физический пересчёт, начальный остаток и сверка первичных документов/единиц.');
      cell(tr,movement?.complete===true?
        'Все страницы журнала прочитаны; причинная сверка не завершена.':
        movement?'Журнал неполный; причина не подтверждена.':
        'Движения не загружены для этой позиции.');
      cell(tr,'Пересчитать физически на указанном складе; затем сверить поступления, перемещения, списания и норму техкарты. Не оформлять оприходование по одному отчёту.');
      rows.append(tr);
    }
    table.hidden=false;
    status.textContent='Срез «МойСклад»: '+snapshot.checkedAt+
      '. Прочитано позиций: '+fmt.format(snapshot.positionsRead)+
      '; строк с отрицательным остатком: '+fmt.format(snapshot.negativeLines)+
      '. Все отчёты неатомарны; сверка физического остатка не выполнена.';
  };
  button.addEventListener('click',async()=>{
    if(busy||!visible())return;
    busy=true;button.disabled=true;
    table.hidden=true;rows.replaceChildren();
    status.textContent='Сначала читаем актуальные остатки по складам, затем полный журнал выбранных движений. Запросы только GET.';
    try{
      const stockResponse=await fetch('/api/ms/negative-stock-details',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(90000)
      });
      const snapshot=await stockResponse.json();
      if(!stockResponse.ok||snapshot?.code!=='ms_negative_stock_details'||
        snapshot.readOnly!==true||snapshot.changedRecords!==0||
        snapshot.completeReportPages!==true||!Array.isArray(snapshot.items)||
        !Number.isSafeInteger(snapshot.positionsRead))
        throw Error('Не удалось подтвердить актуальный отчёт остатков.');
      status.textContent='Остатки прочитаны. Проверяем журнал движений; изменения данных не выполняются.';
      const movementResponse=await fetch('/api/ms/negative-stock-causes',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(90000)
      });
      const audit=await movementResponse.json();
      if(!movementResponse.ok||audit?.code!=='ms_negative_stock_document_causes'||
        audit.readOnly!==true||audit.changedRecords!==0||!Array.isArray(audit.results))
        throw Error('Не удалось получить диагностику движений.');
      render(snapshot,audit);
      const complete=(audit.results||[]).filter(x=>x.complete===true).length;
      status.textContent+=' Полный журнал получен для '+fmt.format(complete)+
        ' из '+fmt.format(audit.requestedItems)+' выбранных материалов. Норма техкарты и физический остаток не подтверждены.';
    }catch(error){
      table.hidden=true;rows.replaceChildren();
      status.textContent=String(error?.message||'Проверка не выполнена')+
        ' Актуальные строки не показываются; проверьте вход владельца и повторите запрос позже.';
    }finally{busy=false;button.disabled=false;}
  });
  const updateVisibility=()=>{button.disabled=busy||!visible();};
  window.addEventListener('hashchange',updateVisibility);
  document.addEventListener('visibilitychange',updateVisibility);
  updateVisibility();
})();
