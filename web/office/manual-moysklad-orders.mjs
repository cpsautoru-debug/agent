// Read-only queue for owner-entered Avito/dealer customer orders in MoySklad.
(()=>{'use strict';
 const root=document.getElementById('ordersIntakeBoard');if(!root)return;
 const section=document.createElement('section');section.className='profit-panel';section.id='manualMoyskladOrders';
 const h=document.createElement('h2');h.textContent='Ручные каналы · МойСклад';section.append(h);
 const intro=document.createElement('p');intro.textContent='Менеджер создаёт заказ покупателя в МойСклад и выбирает точные товары из каталога. Онлайн-офис только читает отмеченные документы и добавляет их в общую очередь. Остатки, наличие, пошив и отгрузка автоматически не подтверждаются.';section.append(intro);
 const details=document.createElement('details');details.className='wb-cost-hints';
 const summary=document.createElement('summary');summary.textContent='Памятка менеджеру: как добавить ручной заказ';details.append(summary);
 const guide=document.createElement('ol');
 const steps=[
  'Создай «Заказ покупателя» в МойСклад. Выбери организацию и склад по фактической схеме продажи.',
  'Добавь позиции, выбирая именно готовый товар/комплект в номенклатуре. Не вводи товар свободным текстом.',
  'В поле «Внешний код» укажи канал и уникальный номер заказа из памятки ниже. Один номер — один заказ.',
  'Сохрани документ. В офисе нажми «Обновить ручные заказы».'
 ];
 for(const t of steps){const li=document.createElement('li');li.textContent=t;guide.append(li);}details.append(guide);
 const note=document.createElement('p');note.textContent='Внешний код: Авито — AS63:manual:avito:AV-ГГГГММДД-001; Пламя — AS63:manual:plamya:PL-ГГГГММДД-001; дилер Руслан — AS63:manual:dealer_ruslan:RUS-ГГГГММДД-001; дилер Ирина — AS63:manual:dealer_irina:IR-ГГГГММДД-001. Номер после последнего двоеточия менеджер увеличивает вручную, чтобы он не повторялся в пределах канала.';details.append(note);
 const caution=document.createElement('p');caution.textContent='Офис читает только документы с точным маркером. Повторяющийся внешний код будет помечен как конфликт. Заказ покупателя — не отгрузка и не подтверждение физического остатка. Для торговой точки/дилера перед первой записью менеджеру нужно выбрать в МойСклад правильную схему: продажа, отсрочка или реализация.';details.append(caution);
 section.append(details);
 const row=document.createElement('div');row.className='wb-unit-actions';
 const button=document.createElement('button');button.type='button';button.className='button light';button.textContent='Обновить ручные заказы';
 const status=document.createElement('p');status.className='wb-monitor-meta';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Данные не загружены. Запрос к МойСклад выполняется только после нажатия.';
 row.append(button);section.append(row,status);
 const coverage=document.createElement('p');coverage.className='wb-monitor-meta';section.append(coverage);
 const wrap=document.createElement('div');wrap.className='table-wrap';
 const table=document.createElement('table');table.className='wb-unit-table';const thead=document.createElement('thead'),trh=document.createElement('tr');
 for(const label of ['Канал','Заказ МойСклад','Дата · статус','Организация · склад','Товар из каталога МойСклад','Кол-во','Обработка']){const th=document.createElement('th');th.textContent=label;trh.append(th);}
 thead.append(trh);const tbody=document.createElement('tbody');table.append(thead,tbody);wrap.append(table);section.append(wrap);
 root.append(section);
 const td=(tr,value)=>{const e=document.createElement('td');e.textContent=value==null||value===''?'—':String(value);tr.append(e);};
 button.addEventListener('click',async()=>{
  if(button.disabled)return;button.disabled=true;status.textContent='Читаем помеченные заказы по страницам. Только GET; записи не создаются.';
  tbody.replaceChildren();coverage.textContent='';
  try{
   const response=await fetch('/api/ms/manual-orders-preview',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(120000)});
   const data=await response.json();
   if(!response.ok||data?.code!=='manual_orders_preview_ok'||data.readOnly!==true||data.changedRecords!==0||data.approvedForWrite!==false||!Array.isArray(data.channels)||!Array.isArray(data.orders))throw Error(data?.code||'api_unavailable');
   const duplicates=new Set((data.duplicateExternalCodes||[]).map(x=>x.externalCode));
   const channelText=data.channels.map(x=>x.label+': '+(x.complete?'полностью · '+x.received+' заказов':'неполно · '+(x.error||'ошибка пагинации')+' · получено '+x.received)).join(' · ');
   coverage.textContent='Покрытие: '+channelText+'. Общая полнота: '+(data.complete?'да':'нет; проверьте ошибки источников.');
   const seenIds=new Set();
   if(data.complete&&duplicates.size===0){
    document.dispatchEvent(new CustomEvent('as63-manual-orders-ready',
     {detail:{readOnly:true,orders:data.orders,sampledAt:data.sampledAt}}));
   }
   for(const order of data.orders){
    const tr=document.createElement('tr');const duplicate=duplicates.has(order.externalCode)||seenIds.has(order.documentId);seenIds.add(order.documentId);
    td(tr,order.sourceLabel);td(tr,order.documentName+' · '+order.manualOrderRef);
    td(tr,[order.moment,order.status].filter(Boolean).join(' · '));
    td(tr,[order.organization,order.store].filter(Boolean).join(' · '));
    td(tr,order.items.map(x=>[x.article||x.code,x.name].filter(Boolean).join(' · ')).join('; '));
    td(tr,order.items.map(x=>String(x.quantity)).join('; '));
    td(tr,duplicate?'КОНФЛИКТ · повтор номера':order.statusType==='Unsuccessful'?'Отменён по статусу МойСклад':'Требуется проверка наличия и назначения');
    tbody.append(tr);
   }
   status.textContent=data.orders.length?'Показано '+data.orders.length+' ручных заказов. Подтверждённые полные выборки без дублей переданы в общую очередь по UUID позиции; складской остаток и готовность к пошиву требуют отдельной проверки.':'Заказов с точным маркером пока нет. Создай заказ покупателя в МойСклад и добавь маркер в поле «Внешний код».';
  }catch(error){
   status.textContent='Не удалось загрузить полный снимок: '+String(error?.message||'ошибка').slice(0,80)+'. Данные частичной выборки скрыты, документы не менялись.';
   tbody.replaceChildren();
  }finally{button.disabled=false;}
 });
})();