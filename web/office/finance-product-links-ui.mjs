import {
  validateFinanceProductLinkDraft
} from './finance-product-links-core.mjs';

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
    'financeLinksRows'];
  if(!fetchData||ids.some(id=>!$(id)))return false;
  const [loadButton,status,form,wb,ozon,from,evidence,same,noCost,
    previewButton,saveButton,previewStatus,rows]=ids.map($);
  let loading=false,saving=false,receipt=null,ready=false;
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
      signal:AbortSignal.timeout(15000)
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
    unauthorized:'Требуется вход владельца.'
  };
  const reset=()=>{ready=false;previewButton.disabled=true;clear();};
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
      const ozonCosts=audit.ozonCatalog.entries
        .filter(x=>typeof x.sku==='string'&&!linkedOzon.has(x.sku))
        .sort((a,b)=>a.sku.localeCompare(b.sku,'ru'));
      setSelect(wb,'Выбрать артикул WB',wbArticles.map(x=>[x,x]));
      setSelect(ozon,'Выбрать SKU Ozon',ozonCosts.map(x=>[
        x.sku+' · '+x.model+' · '+x.sellerArticle,x.sku
      ]));
      drawLinks(registry);
      ready=wbArticles.length>0&&ozonCosts.length>0;
      previewButton.disabled=!ready;
      status.textContent='Подтверждённых связей: '+registry.count+
        '. Доступных артикулов WB: '+wbArticles.length+
        '; SKU Ozon в справочнике: '+ozonCosts.length+
        '. Выбирай пару только после сверки физического изделия; '+
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
        ' ↔ '+result.document.ozonSku+' ('+result.document.modelName+
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
