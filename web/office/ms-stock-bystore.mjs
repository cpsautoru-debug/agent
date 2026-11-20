import {
  pageWarehouseNames,selectStockPageGroups,summarizeStockPageGroups
} from './ms-stock-page-view.mjs';

// Manual owner-only stock view: no background poll, no full inventory claims.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const section=el('msStockSection'),button=el('msStockRefresh');
  const form=el('msStockSearchForm'),input=el('msStockSearch');
  const clear=el('msStockClear'),status=el('msStockStatus');
  const count=el('msStockCount'),rows=el('msStockRows');
  const prev=el('msStockPrev'),next=el('msStockNext'),page=el('msStockPage');
  const warehouse=el('msStockWarehouse'),scopeNote=el('msStockScopeNote');
  const executive=el('msExecutiveStock');
  if(!section||!button||!form||!input||!clear||!status||!count||
    !rows||!prev||!next||!page||!warehouse||!scopeNote||!executive)return;
  const PAGE=10;
  let state={offset:0,search:null},pending=false,hasMore=false;
  let lastPayload=null,lastLoadedAt=null;
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
    warehouse.disabled=pending||!lastPayload;
  };
  const valid=data=>data?.code==='ms_stock_bystore_ok'&&
    data.scope==='PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY'&&
    data.readOnly===true&&data.changedRecords===0&&
    (data.requests===1||data.requests===2)&&
    Number.isSafeInteger(data.namesResolved)&&data.namesResolved>=0&&
    Array.isArray(data.items)&&data.namesResolved<=data.items.length&&
    data.pageSize===PAGE&&data.offset===state.offset&&
    data.search===state.search&&
    Number.isSafeInteger(data.totalAssortmentReportRows)&&
    data.items.length<=PAGE&&Array.isArray(data.warehousesInPage)&&
    typeof data.hasMore==='boolean'&&
    data.items.every(item=>Array.isArray(item.stores));
  const options=payload=>{
    const previous=warehouse.value;
    warehouse.replaceChildren();
    const all=document.createElement('option');
    all.value='';all.textContent='Все склады на странице';
    warehouse.append(all);
    const names=payload?pageWarehouseNames(payload.items):[];
    for(const name of names){
      const option=document.createElement('option');
      option.value=name;option.textContent=name;
      warehouse.append(option);
    }
    warehouse.value=names.includes(previous)?previous:'';
  };
  const renderPage=()=>{
    if(!lastPayload)return;
    const groups=selectStockPageGroups(lastPayload.items,warehouse.value);
    const stats=summarizeStockPageGroups(groups);
    rows.replaceChildren();
    for(const item of groups){
      const stores=item.stores.length?item.stores:[null];
      for(const [index,store] of stores.entries()){
        const tr=document.createElement('tr');
        if(index===0){
          const name=td(tr,item.name?
            item.name+(item.code?' · '+item.code:''):'Название не получено');
          name.rowSpan=stores.length;
          name.className='ms-stock-product-name';
          const unit=td(tr,item.uom||'Не указана');
          unit.rowSpan=stores.length;
        }
        td(tr,store?store.name:'Склады не переданы');
        const physical=td(tr,store?val(store.stock):'Неизвестно');
        if(store&&typeof store.stock==='number'){
          if(store.stock<0)physical.className='ms-stock-negative';
          else if(store.stock===0)physical.className='ms-stock-zero';
        }
        td(tr,store?val(store.reserve):'Неизвестно');
        td(tr,store?val(store.inTransit):'Неизвестно');
        rows.append(tr);
      }
    }
    if(groups.length===0){
      const tr=document.createElement('tr');
      const empty=td(tr,warehouse.value?
        'На этой странице у выбранного склада нет строк. Это не означает нулевой остаток по всему складу.':
        'На этой странице нет позиций. Это не означает нулевые остатки всего бизнеса.');
      empty.colSpan=6;rows.append(tr);
    }
    count.textContent='Номенклатуры в отчёте: '+ru(lastPayload.totalAssortmentReportRows)+
      '; загружено на странице: '+ru(lastPayload.items.length)+
      '; показано по фильтру: '+ru(stats.positions)+
      '; складов на странице: '+ru(pageWarehouseNames(lastPayload.items).length)+'.';
    page.textContent='Страница '+(Math.floor(state.offset/PAGE)+1);
    executive.textContent='На странице '+ru(lastPayload.items.length)+' позиций · '+
      ru(stats.positions)+' после фильтра';
    scopeNote.textContent=warehouse.value?
      'Показан только склад «'+warehouse.value+'» среди загруженных '+PAGE+
      ' позиций. Для других позиций листайте отчёт или используйте поиск.':
      'Показаны склады только для загруженной страницы из '+PAGE+
      ' позиций. Число складов и остатки всего бизнеса не рассчитаны.';
    status.textContent='Данные получены из «МойСклад» · '+lastLoadedAt+
      ' (Самара). В показанных строках: отрицательных остатков '+stats.negative+
      ', нулевых '+stats.zero+', неизвестных '+stats.unknown+
      '. Названия получены: '+ru(lastPayload.namesResolved)+' из '+
      ru(lastPayload.items.length)+' позиций страницы. Переключение склада не запрашивает API.';
  };
  const show=payload=>{
    lastPayload=payload;
    hasMore=payload.hasMore;
    lastLoadedAt=new Intl.DateTimeFormat('ru-RU',{
      timeZone:'Europe/Samara',dateStyle:'short',timeStyle:'short'
    }).format(new Date());
    options(payload);
    renderPage();
  };
  const clearOnFailure=()=>{
    lastPayload=null;lastLoadedAt=null;hasMore=false;
    rows.replaceChildren();
    count.textContent='Нет подтверждённых актуальных данных.';
    executive.textContent='Нет свежих подтверждённых данных';
    scopeNote.textContent='Складской отчёт не загружен.';
    options(null);
  };
  const load=async ()=>{
    if(pending||!visible())return;
    pending=true;controls();
    status.textContent='Читаем только одну страницу остатков из «МойСклад»…';
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
      show(body);
    }catch(error){
      clearOnFailure();
      status.textContent='Остатки не обновлены: '+String(error?.message||'request_failed').slice(0,90)+
        '. Данные не подтверждены; нулевые остатки не подставлены.';
    }finally{
      pending=false;controls();
    }
  };
  button.addEventListener('click',()=>{state.offset=0;load();});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const value=input.value.trim();
    if(value&&(!/^[\p{L}\p{N} .,_+\-/()]{2,60}$/u.test(value)||
      /\s{2}/.test(value))){
      status.textContent='Укажите название от 2 до 60 символов без управляющих знаков.';
      return;
    }
    state={offset:0,search:value||null};hasMore=false;load();
  });
  clear.addEventListener('click',()=>{
    input.value='';state={offset:0,search:null};hasMore=false;load();
  });
  warehouse.addEventListener('change',()=>{if(lastPayload&&!pending)renderPage();});
  prev.addEventListener('click',()=>{
    if(!pending&&state.offset>=PAGE){state.offset-=PAGE;load();}
  });
  next.addEventListener('click',()=>{
    if(!pending&&hasMore&&state.offset<=4980){state.offset+=PAGE;load();}
  });
  controls();
})();
