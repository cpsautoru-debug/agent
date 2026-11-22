import {
  validateFinanceProductLinkDraft
} from './finance-product-links-core.mjs';
import {
  makeFinanceReviewGroups
} from './finance-link-review-groups.mjs';

// Verified identity is owner-provided, not inferred. Read-only until explicit
// preview + signed confirm. Existing WB/Ozon prices are never edited.
export function attachFinanceProductLinks({
  documentRef=typeof document==='undefined'?null:document,
  fetchData=typeof fetch==='undefined'?null:fetch
}={}){
  const $=id=>documentRef?.getElementById(id);
  const ids=['financeLinksLoad','financeLinksStatus','financeLinksForm',
    'financeLinksWb','financeLinksOzon','financeLinksFrom',
    'financeLinksEvidence','financeLinksSame','financeLinksNoCost',
    'financeLinksPreview','financeLinksSave','financeLinksPreviewStatus',
    'financeLinksRows','financeLinksGroupFilter',
    'financeLinksGroupStatus','financeWbCardLookupButton',
    'financeWbCardLookupStatus'];
  if(!fetchData||ids.some(id=>!$(id)))return false;
  const [loadButton,status,form,wb,ozon,from,evidence,same,noCost,
    previewButton,saveButton,previewStatus,rows,groupFilter,
    groupStatus,wbLookupButton,wbLookupStatus]=ids.map($);
  let loading=false,saving=false,receipt=null,ready=false,wbLoading=false;
  let wbCardTitles=new Map();
  let loadedWb=[],loadedOzon=[],reviewGroups=[],ambiguousWb=0,ambiguousOzon=0;
  const make=(tag,content)=>{
    const el=documentRef.createElement(tag);
    if(content!==undefined)el.textContent=String(content);
    return el;
  };
  const clear=()=>{receipt=null;saveButton.disabled=true;};
  const option=(label,value)=>{
    const o=make('option',label);o.value=value;return o;
  };
  const setSelect=(target,placeholder,values)=>{
    target.replaceChildren(option(placeholder,''));
    for(const [label,value] of values)target.append(option(label,value));
    target.value='';
  };
  const request=async(path,method='GET',body=null)=>{
    const res=await fetchData(path,{
      method,credentials:'same-origin',cache:'no-store',
      headers:method==='GET'?{Accept:'application/json'}:
        {'Content-Type':'application/json','Accept':'application/json'},
      ...(body===null?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(path==='/api/finance/wb-content-cards'?28000:15000)
    });
    let json;
    try{json=await res.json();}catch{throw Error('invalid_response');}
    if(!res.ok)throw Error(json?.code||'source_unavailable');
    return json;
  };
  const MESSAGES={
    product_source_not_verified:'Пара не подтверждена: артикул WB или SKU Ozon отсутствует в проверенных источниках.',
    product_link_already_exists:'Этот артикул WB или SKU Ozon уже связан. Повторная запись запрещена.',
    product_link_preview_changed_or_expired:'Проверка устарела или источник изменился. Проверь заново.',
    product_link_conflict_refresh:'Связь уже добавлена кем-то другим. Обнови список.',
    finance_product_links_migration_required:'Сначала примените отдельную миграцию 0005 к тестовой Pages D1 — текущие цены и операции не изменятся.',
    invalid_product_link:'Укажи артикул, SKU, действительную дату и основание. Подтверди физическое совпадение изделия.',
    origin_denied:'Неверный источник запроса.',
    forbidden:'Недостаточно прав владельца.',
    unauthorized:'Требуется вход владельца.',
    ozon_identity_source_unavailable:'Не удалось повторно подтвердить карточку SKU через Ozon Seller API. Сохранение заблокировано.',
    ozon_profit_sku_not_verified:'SKU отсутствует в подтверждённых источниках Ozon Profit.',
    ozon_sku_card_not_found:'SKU не найден в подключённом кабинете Ozon.',
    ozon_identity_rate_limited:'Ozon временно ограничил API. Попробуй позже.'
  };
  const reset=()=>{
    ready=false;previewButton.disabled=true;clear();
    loadedWb=[];loadedOzon=[];reviewGroups=[];wbCardTitles=new Map();
    ambiguousWb=0;ambiguousOzon=0;
    wbLookupButton.disabled=true;
    wbLookupStatus.textContent='Названия WB ещё не запрашивались.';
    groupFilter.disabled=true;
    setSelect(groupFilter,'Все товары WB и Ozon',[]);
    groupStatus.textContent='Группы ещё не загружены.';
  };
  const showFiltered=()=>{
    clear();
    const group=reviewGroups.find(g=>g.key===groupFilter.value);
    const visibleWb=group?loadedWb.filter(s=>group.wbArticles.includes(s)):
      loadedWb;
    const visibleOzon=group?loadedOzon.filter(o=>group.ozonSkus.includes(o.sku)):
      loadedOzon;
    setSelect(wb,'Выбрать артикул WB',
      visibleWb.map(x=>[x,x]));
    setSelect(ozon,'Выбрать SKU Ozon',
      visibleOzon.map(x=>[
        x.sku+' · '+x.name+
          (x.source==='seller_api'?' · карточка Seller API':''),
        x.sku
      ]));
    ready=visibleWb.length>0&&visibleOzon.length>0;
    previewButton.disabled=!ready;
    groupStatus.textContent=group?
      'Для проверки, НЕ подтверждено: '+group.label+
      '. Артикулов WB: '+visibleWb.length+
      ', SKU Ozon: '+visibleOzon.length+
      '. Подбор только по модели и типу, материалы, цвет, крой и комплектацию проверь отдельно.':
      'Показаны все загруженные товары. Групп с общими моделью и типом: '+
      reviewGroups.length+'. Не распознаны однозначно: WB '+ambiguousWb+
      ', Ozon '+ambiguousOzon+
      '. Это не отсутствие товара и не нулевая себестоимость.';
  };
  const rebuildGroups=()=>{
    const suggestions=makeFinanceReviewGroups(
      loadedWb,loadedOzon,wbCardTitles
    );
    reviewGroups=suggestions.groups;
    ambiguousWb=suggestions.ambiguousWb;
    ambiguousOzon=suggestions.ambiguousOzon;
    setSelect(groupFilter,'Все товары WB и Ozon',
      reviewGroups.map(g=>[
        g.label+' · WB '+g.wbCount+' / Ozon '+g.ozonCount,
        g.key
      ]));
    groupFilter.disabled=reviewGroups.length===0;
    showFiltered();
  };
  groupFilter.addEventListener('change',()=>{
    if(!loading&&!saving&&!wbLoading)showFiltered();
  });
  wbLookupButton.addEventListener('click',async()=>{
    if(loading||saving||wbLoading||!loadedWb.length)return;
    wbLoading=true;wbLookupButton.disabled=true;clear();
    wbLookupStatus.textContent='Проверяем текущие карточки WB. Сохранение связей заблокировано до завершения проверки.';
    try{
      const result=await request('/api/finance/wb-content-cards');
      if(result?.code!=='wb_content_card_lookup'||
        result.source!=='wb_content_api_live'||
        result.readOnly!==true||result.changedRecords!==0||
        !Array.isArray(result.items)||
        !Array.isArray(result.unmatched)||
        !Number.isSafeInteger(result.totalFinanceCodes)||
        result.physicalIdentityVerified!==false)
        throw Error('invalid_wb_card_source');
      const codeSet=new Set(loadedWb);
      const titles=new Map();
      for(const item of result.items){
        if(typeof item.vendorCode!=='string'||
          typeof item.title!=='string'||!item.title||
          item.physicalIdentityVerified!==false||
          item.costTransferred!==false)throw Error('invalid_wb_card_source');
        if(codeSet.has(item.vendorCode)){
          if(titles.has(item.vendorCode))throw Error('invalid_wb_card_source');
          titles.set(item.vendorCode,item.title);
        }
      }
      wbCardTitles=titles;
      rebuildGroups();
      wbLookupStatus.textContent='Точные карточки WB прочитаны: '+
        result.matchedCount+' из '+result.totalFinanceCodes+
        ' финансовых артикулов; улучшены подсказки для '+
        titles.size+' доступных в форме. Просмотр страниц WB: '+
        result.pagesRead+'. '+
        (result.fullyScanned?
          'Выборка текущих карточек WB завершена.':
          'Выборка ограничена: остальные коды не считаются отсутствующими.')+
        ' Никакие пары не выбраны и не сохранены.';
    }catch(error){
      const messages={
        wb_content_token_not_configured:
          'Токен WB Content API не настроен в Pages. Нужны права «Контент» для чтения карточек. Финансовый токен менять не требуется.',
        wb_content_scope_required:
          'WB отклонил доступ: текущий токен не имеет категории «Контент» для чтения карточек. Нужен отдельный Content API токен.',
        wb_content_api_rate_limited:
          'WB ограничил запросы. Повторите позднее.',
        wb_content_api_cursor_unavailable:
          'WB не вернул корректный курсор для дальнейшего чтения. Данные не применены.'
      };
      wbLookupStatus.textContent=messages[error?.message]||
        'Не удалось проверить карточки WB. Группы по прежним названиям сохранены; финансовые данные не менялись.';
    }finally{wbLoading=false;wbLookupButton.disabled=!loadedWb.length;}
  });
  const drawLinks=data=>{
    rows.replaceChildren();
    for(const link of data.links){
      const tr=make('tr');
      for(const v of [link.wbVendorCode,link.ozonSku,
        link.modelName,link.verifiedFrom,'Проверена идентичность; цена отдельно'])
        tr.append(make('td',v));
      rows.append(tr);
    }
    if(!data.links.length){
      const tr=make('tr');
      tr.append(make('td','Пока нет подтверждённых связей. Это не нулевая себестоимость.'));
      rows.append(tr);
    }
  };
  async function load(){
    if(loading||saving)return;
    loading=true;loadButton.disabled=true;reset();
    status.textContent='Проверяем журнал, артикулы WB и SKU Ozon…';
    try{
      const registry=await request('/api/finance/product-links');
      if(registry?.code==='finance_product_links_migration_required'){
        status.textContent=MESSAGES.finance_product_links_migration_required;
        setSelect(wb,'Сначала применить миграцию',[]);
        setSelect(ozon,'Сначала применить миграцию',[]);
        rows.replaceChildren();
        return;
      }
      if(registry?.code!=='finance_product_links'||
        registry.status!=='ready'||registry.readOnly!==true||
        registry.changedRecords!==0||!Array.isArray(registry.links)||
        registry.count!==registry.links.length)
        throw Error('source_unavailable');
      const [wbData,audit]=await Promise.all([
        request('/api/wb/unit-economics'),
        request('/api/finance/cost-audit')
      ]);
      if(wbData?.code!=='wb_unit_economics_preview'||
        wbData.source!=='WB_FINANCE_API_D1'||
        wbData.scope!=='ALL_COMPLETED_WB_REPORTS_NOT_CALENDAR_MONTH'||
        !Array.isArray(wbData.articles)||
        audit?.code!=='unified_finance_source_audit'||
        !Array.isArray(audit.ozonCatalog?.entries))
        throw Error('source_unavailable');
      const linkedWb=new Set(registry.links.map(x=>x.wbVendorCode));
      const linkedOzon=new Set(registry.links.map(x=>x.ozonSku));
      const wbArticles=[...new Set(wbData.articles.map(x=>x.vendorCode))]
        .filter(x=>typeof x==='string'&&x&&!linkedWb.has(x))
        .sort((a,b)=>a.localeCompare(b,'ru'));
      // The auxiliary Ozon cost catalog contains only a few SKUs. Load
      // exact Seller API identities for Profit-only numeric SKUs on the
      // owner's explicit button press. Never copy their COGS or auto-link.
      const ozonOptions=new Map(audit.ozonCatalog.entries
        .filter(x=>typeof x.sku==='string'&&!linkedOzon.has(x.sku))
        .map(x=>[x.sku,{
          sku:x.sku,name:x.model+' · '+x.sellerArticle,source:'local'
        }]));
      let sellerFound=0,sellerWarning='';
      if(audit.skuCoverage?.profitOnlySkuCount>0){
        try{
          const fresh=await request('/api/finance/ozon-sku-cards');
          if(fresh?.code!=='ozon_sku_cards_lookup'||
            fresh.readOnly!==true||fresh.changedRecords!==0||
            fresh.source!=='ozon_seller_api_v3_product_info_list'||
            fresh.accountScope!=='connected_ozon_client_only'||
            !Array.isArray(fresh.items)||!Array.isArray(fresh.notFound)||
            !Array.isArray(fresh.unsupported)||
            fresh.missingFromLocalCatalog!==
              audit.skuCoverage.profitOnlySkuCount||
            fresh.foundCount!==fresh.items.length)
            throw Error('invalid_seller_source');
          for(const item of fresh.items){
            if(typeof item.sku!=='string'||
              typeof item.name!=='string'||!item.name||
              typeof item.offerId!=='string'||!item.offerId||
              item.physicalIdentityVerified!==false||
              item.costTransferred!==false)
              throw Error('invalid_seller_source');
            if(linkedOzon.has(item.sku))continue;
            if(ozonOptions.has(item.sku))throw Error('duplicate_seller_sku');
            ozonOptions.set(item.sku,{
              sku:item.sku,name:item.name+' · '+item.offerId,
              source:'seller_api'
            });
            sellerFound++;
          }
          if(fresh.notFound.length||fresh.unsupported.length)
            sellerWarning=' Не найдены или не поддерживаются: '+
              (fresh.notFound.length+fresh.unsupported.length)+' SKU.';
        }catch{
          sellerWarning=' Карточки вне локального справочника сейчас не удалось проверить; их нельзя связывать до ответа Ozon.';
        }
      }
      const ozonCosts=[...ozonOptions.values()]
        .sort((a,b)=>a.sku.localeCompare(b.sku,'ru'));
      loadedWb=wbArticles;loadedOzon=ozonCosts;
      rebuildGroups();
      wbLookupButton.disabled=false;
      wbLookupStatus.textContent='Можно уточнить названия WB через Content API. Запрос только по нажатию.';
      drawLinks(registry);
      status.textContent='Подтверждённых связей: '+registry.count+
        '. Доступных артикулов WB: '+wbArticles.length+
        '; всего доступных SKU Ozon: '+ozonCosts.length+
        ' (из Seller API дополнительно: '+sellerFound+').'+sellerWarning+
        ' Выбирай пару только после сверки физического изделия; '+
        'производственная себестоимость автоматически не переносится.';
    }catch(error){
      status.textContent=MESSAGES[error?.message]||
        'Источники не удалось проверить. Записи заблокированы. Основные финансы работают отдельно.';
      rows.replaceChildren();
      reset();
    }finally{loading=false;loadButton.disabled=false;}
  }
  function draft(){
    if(!ready)throw Error('not_ready');
    return validateFinanceProductLinkDraft({
      wbVendorCode:wb.value,ozonSku:ozon.value,
      verifiedFrom:from.value,evidence:evidence.value.trim(),
      identicalPhysicalProduct:same.checked,
      noAutomaticCostTransfer:noCost.checked
    });
  }
  for(const element of [wb,ozon,from,evidence,same,noCost]){
    element.addEventListener('change',clear);
    element.addEventListener('input',clear);
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!ready||saving)return;
    clear();
    let doc;
    try{doc=draft();}catch{
      previewStatus.textContent=MESSAGES.invalid_product_link;return;
    }
    saving=true;previewButton.disabled=true;
    try{
      const result=await request('/api/finance/product-links','POST',
        {action:'preview',document:doc});
      if(result?.code!=='finance_product_link_preview'||
        result.readOnly!==true||result.changedRecords!==0||
        result.document?.wbVendorCode!==doc.wbVendorCode||
        result.document?.ozonSku!==doc.ozonSku||
        typeof result.token!=='string')
        throw Error('invalid_response');
      receipt={doc,token:result.token};
      saveButton.disabled=false;
      previewStatus.textContent='ПРЕДПРОСМОТР: '+doc.wbVendorCode+
        ' ↔ '+result.document.ozonSku+' ('+
        (result.document.ozonProductTitle||result.document.modelName)+
        '). Проверено с '+doc.verifiedFrom+
        '. НИЧЕГО НЕ СОХРАНЕНО. Для фиксации одной связи нажми отдельную кнопку в течение 10 минут.';
    }catch(error){
      previewStatus.textContent=MESSAGES[error?.message]||
        'Не удалось проверить пару. Запись заблокирована.';
    }finally{saving=false;previewButton.disabled=!ready;}
  });
  saveButton.addEventListener('click',async()=>{
    if(!receipt||saving)return;
    let doc;
    try{doc=draft();}catch{clear();return;}
    if(JSON.stringify(doc)!==JSON.stringify(receipt.doc)){
      clear();previewStatus.textContent='Форма изменилась. Повтори проверку.';return;
    }
    saving=true;saveButton.disabled=true;previewButton.disabled=true;
    let saved=false;
    try{
      const res=await request('/api/finance/product-links','POST',
        {action:'confirm',document:doc,token:receipt.token});
      if(res.code!=='finance_product_link_saved'||
        res.changedRecords!==1||res.costTransferred!==false)
        throw Error('invalid_response');
      receipt=null;
      previewStatus.textContent='Подтверждена одна связь. Стоимость товаров и отчёты не изменены.';
      saved=true;
    }catch(error){
      clear();
      previewStatus.textContent=MESSAGES[error?.message]||
        'Сохранение не подтверждено. Обнови журнал перед повтором.';
    }finally{saving=false;previewButton.disabled=!ready;}
    if(saved)await load();
  });
  loadButton.addEventListener('click',()=>{void load();});
  return true;
}
if(typeof document!=='undefined')attachFinanceProductLinks();
