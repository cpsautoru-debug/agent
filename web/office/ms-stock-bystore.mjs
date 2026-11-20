// Manual paged stock-by-store view. Never guesses missing stock or adds unlike units.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const section=el('msStockSection'),button=el('msStockRefresh');
  const form=el('msStockSearchForm'),input=el('msStockSearch');
  const clear=el('msStockClear'),status=el('msStockStatus');
  const count=el('msStockCount'),rows=el('msStockRows');
  const prev=el('msStockPrev'),next=el('msStockNext'),page=el('msStockPage');
  const executive=el('msExecutiveStock');
  if(!section||!button||!form||!input||!clear||!status||!count||
    !rows||!prev||!next||!page||!executive)return;
  const PAGE=10;
  let state={offset:0,search:null},pending=false,hasMore=false;
  const ru=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n);
  const val=n=>typeof n==='number'&&Number.isFinite(n)?ru(n):'Неизвестно';
  const td=(tr,v)=>{
    const cell=document.createElement('td');
    cell.textContent=String(v);
    tr.append(cell);
    return cell;
  };
  const visible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const controls=()=>{
    button.disabled=pending;
    form.querySelector('button[type="submit"]').disabled=pending;
    clear.disabled=pending;
    prev.disabled=pending||state.offset===0;
    next.disabled=pending||!hasMore;
  };
  const valid=data=>data?.code==='ms_stock_bystore_ok'&&
    data.scope==='PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY'&&
    data.readOnly===true&&data.changedRecords===0&&
    data.pageSize===PAGE&&data.offset===state.offset&&
    data.search===state.search&&
    Number.isSafeInteger(data.totalAssortmentReportRows)&&
    Array.isArray(data.items)&&data.items.length<=PAGE&&
    Array.isArray(data.warehousesInPage)&&typeof data.hasMore==='boolean'&&
    data.items.every(item=>Array.isArray(item.stores));
  const show=(payload)=>{
    rows.replaceChildren();
    hasMore=payload.hasMore;
    let shown=0,negative=0,unknown=0;
    for(const item of payload.items){
      if(item.stores.length===0){
        const tr=document.createElement('tr');
        td(tr,item.name||'Наименование не передано');
        td(tr,item.uom||'—');
        td(tr,'Склады не переданы');
        td(tr,'Неизвестно');td(tr,'Неизвестно');td(tr,'Неизвестно');
        rows.append(tr);
        unknown++;
        continue;
      }
      for(const store of item.stores){
        const tr=document.createElement('tr');
        td(tr,item.name||'Наименование не передано');
        td(tr,item.uom||'—');
        td(tr,store.name);
        const physical=td(tr,val(store.stock));
        if(typeof store.stock!=='number')unknown++;
        else if(store.stock<0){negative++;physical.className='ms-stock-negative';}
        else if(store.stock===0)physical.className='ms-stock-zero';
        td(tr,val(store.reserve));
        td(tr,val(store.inTransit));
        rows.append(tr);
        shown++;
      }
    }
    if(payload.items.length===0){
      const tr=document.createElement('tr');
      const empty=td(tr,'В этом диапазоне строк нет. Это не доказательство нулевых остатков по складам.');
      empty.colSpan=6;
      rows.append(tr);
    }
    count.textContent='Номенклатуры в отчёте: '+ru(payload.totalAssortmentReportRows)+
      '; на странице: '+ru(payload.items.length)+
      '; складов в этой выборке: '+ru(payload.warehousesInPage.length)+'.';
    page.textContent='Страница '+(Math.floor(state.offset/PAGE)+1);
    executive.textContent=payload.items.length?
      'Показано '+ru(payload.items.length)+' позиций · '+ru(payload.warehousesInPage.length)+' склада(ов) в выборке':
      'На этой странице позиций нет';
    status.textContent='Загружено из «МойСклад» · '+new Intl.DateTimeFormat('ru-RU',{
      timeZone:'Europe/Samara',dateStyle:'short',timeStyle:'short'
    }).format(new Date())+' (Самара). Отрицательных остатков на видимой странице: '+
      negative+'. Строк без подтверждённого остатка: '+unknown+
      '. Не полный отчёт по всем складам.';
  };
  const load=async ()=>{
    if(pending||!visible())return;
    pending=true;controls();
    status.textContent='Читаем только одну страницу остатков из «МойСклад»…';
    let success=false;
    try{
      const q=new URLSearchParams();
      if(state.offset)q.set('offset',String(state.offset));
      if(state.search!==null)q.set('search',state.search);
      const response=await fetch('/api/ms/stock-bystore'+(q.size?'?'+q.toString():''),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)
      });
      const body=await response.json();
      if(!response.ok||!valid(body)){
        const code=typeof body?.code==='string'&&
          /^[a-z][a-z0-9_]{0,60}$/.test(body.code)?body.code:'invalid_stock_response';
        const http=Number.isInteger(body?.upstreamHttp)&&
          body.upstreamHttp>=300&&body.upstreamHttp<=599?' · HTTP '+body.upstreamHttp:'';
        throw Error(code+http);
      }
      show(body);success=true;
    }catch(error){
      status.textContent='Остатки не обновлены: '+String(error?.message||'request_failed').slice(0,90)+
        '. Ранее показанные данные не подтверждены как свежие, нули не подставлены.';
      executive.textContent='Нет свежих подтверждённых данных';
    }finally{
      if(!success)hasMore=false;
      pending=false;controls();
    }
  };
  button.addEventListener('click',()=>{state.offset=0;load();});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const value=input.value.trim();
    if(value&&(!/^[\p{L}\p{N}\s.,_+\-/()]{2,60}$/u.test(value)||
      /\s{2}/.test(value))){
      status.textContent='Укажите название от 2 до 60 символов без управляющих знаков.';
      return;
    }
    state={offset:0,search:value||null};hasMore=false;load();
  });
  clear.addEventListener('click',()=>{
    input.value='';state={offset:0,search:null};hasMore=false;load();
  });
  prev.addEventListener('click',()=>{
    if(!pending&&state.offset>=PAGE){state.offset-=PAGE;load();}
  });
  next.addEventListener('click',()=>{
    if(!pending&&hasMore&&state.offset<=4980){state.offset+=PAGE;load();}
  });
  controls();
})();