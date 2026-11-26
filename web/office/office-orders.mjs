export function compactOrders(data){
 const checks=new Map((data?.fulfillment||[]).map(c=>[c.orderKey,c]));
 return (data?.orders||[]).filter(o=>o.queue_bucket==='active'||o.queue_bucket==='review').map(o=>{
  const check=checks.get(o.order_key),lines=check?.lines||[],known=lines.length===o.items.length&&lines.length>0;
  const need=known&&lines.some(l=>l.status==='sewing_required');
  const planned=known&&lines.every(l=>['production_covered','warehouse_covered'].includes(l.status));
  return {order:o,check,need,status:need?'Требуется пошив':planned?'Обеспеченность учётно проверена':'Требует уточнения',action:need?'Открыть потребность и проверить распределение':planned?'Проверить физическую готовность к отгрузке':'Подтвердить SKU, склад, остаток и резерв'};
 });
}
if(typeof document!=='undefined'){
 const root=document.getElementById('officeOrders'),board=document.getElementById('ordersIntakeBoard');
 if(root&&board){
  const detail=document.createElement('details');detail.className='office-panel';detail.id='officeOrderOperations';const summary=document.createElement('summary');summary.textContent='Проверки склада, резервы и действия с заказами';detail.append(summary);board.before(detail);detail.append(board);
  for(const event of ['as63:focus-sku','as63:focus-route'])document.addEventListener(event,()=>{detail.open=true});
  let latest=null,channel='';const rows=document.getElementById('officeOrderRows'),note=document.getElementById('officeOrdersNote');
  function render(){
   const entries=compactOrders(latest?.data),filtered=entries.filter(e=>!channel||(channel==='ozon'?['ozon','ozon_fbo'].includes(e.order.source):e.order.source===channel));
   const kpis=[['Новые',latest?.workflowReady?String(entries.filter(e=>!latest.workflow.some(w=>w.order_key===e.order.order_key&&w.workflow_state!=='pending_review')).length):'Нет данных','Не просмотренные владельцем в выборке'],['Нужно произвести',latest?String(entries.filter(e=>e.need).length):'Нет данных','Заказы с подтверждённой потребностью; охват может быть неполным'],['В производстве','Не подтверждено','План задания не доказывает фактическое начало пошива'],['Готово к отгрузке','Не подтверждено','Учётное наличие не заменяет физическую проверку']];
   document.getElementById('officeOrderKpis').replaceChildren(...kpis.map(([title,value,caption])=>{const a=document.createElement('a');a.href='#orders/'+(title==='Нужно произвести'?'need-production':'all');a.className='office-kpi';for(const [tag,text]of [['span',title],['strong',value],['small',caption]]){const el=document.createElement(tag);el.textContent=text;a.append(el)}return a}));
   rows.replaceChildren();const needOnly=location.hash.split('/')[1]==='need-production';
   for(const e of filtered.filter(e=>!needOnly||e.need)){const o=e.order,tr=document.createElement('tr');for(const value of [o.external_id+' · '+({ozon:'Ozon',ozon_fbo:'Ozon FBO',wb:'WB',yandex:'Яндекс'}[o.source]||o.source),o.items.map(i=>i.name||i.sku||i.itemId).join('; '),o.items.map(i=>i.quantity).join('; '),'Не указан']){const td=document.createElement('td');td.textContent=value;tr.append(td)}const td=document.createElement('td'),d=document.createElement('details'),s=document.createElement('summary');s.textContent=e.status;d.append(s);for(const text of [e.action,'Статус источника: '+o.source_status,'Снимок: '+o.source_checked_at]){const p=document.createElement('p');p.textContent=text;d.append(p)}const b=document.createElement('button');b.type='button';b.textContent='Открыть проверки и действия';b.addEventListener('click',()=>{detail.open=true;document.getElementById('persistentOrdersRefresh')?.scrollIntoView({block:'center'})});d.append(b);td.append(d);tr.append(td);rows.append(tr)}
   note.textContent=latest?'Показано '+rows.children.length+' заказов из сохранённой выборки (до 150). Полнота источников: '+(latest.data.coverageDiagnostics?.complete===true?'подтверждена':'не доказана')+'. История и доставка остаются в подробных проверках.':'Нет загруженных данных. Откройте проверки и нажмите «Показать сохранённую очередь»; доступность не считается нулевой.';
   const waiting=document.getElementById('officeHomeWaiting');if(waiting)waiting.textContent=latest?entries.filter(e=>e.need).length+' заказов в проверенной выборке':'Нужно проверить очередь';
   document.querySelectorAll('[data-channel]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.channel===channel)));
  }
  document.addEventListener('office:orders-rendered',e=>{latest=e.detail;render()});document.getElementById('officeOrderFilters').addEventListener('click',e=>{const b=e.target.closest('[data-channel]');if(b){channel=b.dataset.channel;render()}});window.addEventListener('hashchange',render);render();
 }
}
