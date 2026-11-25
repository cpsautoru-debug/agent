// Owner-only, auto-triggered, limited Ozon Seller API SKU identity check.
// Current Seller API names are read-only; Profit source is the authority.
// This does NOT certify transaction-date COGS, refunds or net profit.
const rub=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',
 {style:'currency',currency:'RUB'}).format(n/100):'Не определена';
const el=(tag,text)=>{const node=document.createElement(tag);
 if(text!==undefined)node.textContent=String(text);return node;};
export function attachOzonMissingSkuAutoSync({doc=document,win=window,fetcher=fetch}={}){
 const sections=['ozonFinance','ozonProfit'].map(n=>doc.querySelector(
  '[data-section="'+n+'"]')).filter(Boolean);
 if(!sections.length)return false;
 const box=el('section');box.className='profit-panel';box.id='ozonMissingSkuSync';
 const heading=el('h3','Официальные карточки Ozon · сверка SKU');
 const note=el('p','Один запрос к Ozon Seller API при открытии финансов. '+
  'Совпадения SKU и артикула с нормативом производителя показываются только '+
  'как кандидаты себестоимости. Данные Ozon Profit не изменяются.');
 const state=el('p','Карточки ещё не запрашивались.');
 state.id='ozonMissingSkuSyncStatus';state.setAttribute('role','status');
 const refresh=el('button','Проверить Ozon снова');refresh.type='button';
 const detail=el('details');const label=el('summary','Подробности проверки SKU');detail.append(label);
 const table=el('table');const header=el('tr');
 for(const t of ['SKU','Артикул из финансов','Название Seller API','Норматив','Результат']){
  header.append(el('th',t));
 }
 const thead=el('thead');thead.append(header);table.append(thead);
 const body=el('tbody');table.append(body);detail.append(table);
 box.append(heading,note,state,refresh,detail);
 // One central section; linked from both finance pages.
 sections[0].querySelector('.page-heading')?.after(box);
 if(!box.parentNode)sections[0].prepend(box);
 if(sections.length>1){
  const link=el('a','Карточки Ozon и сопоставление SKU →');
  link.href='#ozonFinance';sections[1].prepend(link);
 }
 let busy=false,loaded=false;
 function validResponse(x){
  return x?.code==='ozon_accrual_sku_cards'&&
   x.source==='OZON_SELLER_API_CURRENT'&&
   Number.isSafeInteger(x.changedRecords)&&x.changedRecords>=0&&
   Number.isSafeInteger(x.foundCount)&&
   Array.isArray(x.items)&&x.foundCount===x.items.length&&
   Array.isArray(x.notFound);
 }
 async function load(){
  if(busy)return;busy=true;refresh.disabled=true;
  state.textContent='Получаем точные карточки из подключённого кабинета Ozon…';
  try{
   const r=await fetcher('/api/finance/ozon-accrual-sku-cards',{
    method:'GET',credentials:'same-origin',cache:'no-store',
    headers:{Accept:'application/json'},
    signal:AbortSignal.timeout(25000)
   });
   const data=await r.json();
   if(!r.ok)throw Error(data?.code||'source_unavailable');
   if(!validResponse(data))throw Error('unexpected_source');
   body.replaceChildren();
   let candidates=0,requiresReview=0;
   for(const item of data.items){
    const tr=el('tr');
    const ready=Number.isSafeInteger(item.referenceCostKopecks)&&
      item.referenceCostKopecks>0&&item.exactArticleMatch===true&&
      !/подлокот|премиум|premium/i.test(item.name);
    if(ready)candidates++;else requiresReview++;
    for(const val of [item.sku,item.ledgerArticle??'—',item.name,
      rub(item.referenceCostKopecks),
      item.referenceCostKopecks===null?'Нет надёжного норматива':
       item.exactArticleMatch!==true?'Артикул не совпадает':
       /подлокот|премиум|premium/i.test(item.name)?
        'Особая комплектация — отдельная проверка':
       'Норматив-кандидат; цена на дату продажи не проверена'])
       tr.append(el('td',val));
    body.append(tr);
   }
   state.textContent='Ozon Seller API: получено '+data.foundCount+
    ' карточек из '+data.missingCount+' SKU без цены в основном Ozon Profit. '+
    'Предварительных кандидатов: '+candidates+
    '; необходима отдельная проверка: '+requiresReview+'. '+
    'Изменений финансовых данных: '+data.changedRecords+
    '. Не найдено в API: '+data.notFound.length+
    '. Исторические цены и подтверждённая прибыль не изменены.';
   loaded=true;
  }catch(err){
   const messages={unauthorized:'Требуется вход владельца в онлайн-офис.',
    forbidden:'Нет доступа владельца.',
    seller_api_credentials_rejected:'Ozon отклонил API-ключи.',
    seller_api_rate_limit:'Ozon ограничил запросы.',
    source_unavailable:'Источник недоступен.',
    configuration_unavailable:'Не настроена связь с финансовой D1.'};
   state.textContent=messages[err?.message]||
    'Не удалось подтвердить карточки Ozon. Себестоимость не считаем нулевой.';
  }finally{busy=false;refresh.disabled=false;}
 }
 const activate=()=>{
  const page=win.location.hash.split('/')[0];
  if((page==='#ozonFinance'||page==='#ozonProfit')&&!loaded)void load();
 };
 refresh.addEventListener('click',()=>{loaded=false;void load();});
 win.addEventListener('hashchange',activate);activate();
 return true;
}
if(typeof document!=='undefined')attachOzonMissingSkuAutoSync();
