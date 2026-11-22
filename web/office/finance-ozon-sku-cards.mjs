// Owner-triggered, read-only enrichment. No automatic Seller API calls.
const MESSAGES={
  unauthorized:'Требуется вход владельца в онлайн-офис.',
  forbidden:'У этой сессии нет доступа владельца.',
  ozon_sku_lookup_not_configured:'В Pages нет доступных ключей или связи с Ozon Profit.',
  ozon_profit_source_unavailable:'Версионный источник Ozon Profit временно недоступен.',
  ozon_catalog_source_incomplete:'Список известных SKU неполный. Проверка остановлена.',
  ozon_seller_api_auth_failed:'Ozon Seller API отклонил ключи подключённого кабинета.',
  ozon_seller_api_rate_limited:'Ozon ограничил число запросов. Повторить позднее.',
  ozon_seller_api_unavailable:'Ozon Seller API ответил ошибкой. Карточки не обновлены.',
  ozon_seller_api_network_unavailable:'Нет ответа от Ozon. Карточки не обновлены.',
  ozon_seller_api_invalid_response:'Ответ Ozon не удалось проверить.',
  ozon_sku_lookup_unavailable:'Источник карточек не подтверждён.'
};
export function attachOzonSkuLookup({
  documentRef=typeof document==='undefined'?null:document,
  windowRef=typeof window==='undefined'?null:window,
  fetchData=typeof fetch==='undefined'?null:fetch
}={}){
  const $=id=>documentRef?.getElementById(id);
  const button=$('financeOzonSkuLookupButton');
  const status=$('financeOzonSkuLookupStatus');
  const rows=$('financeOzonSkuLookupRows');
  if(!button||!status||!rows||!windowRef||!fetchData)return false;
  let busy=false;
  const row=(values)=>{
    const tr=documentRef.createElement('tr');
    for(const value of values){
      const td=documentRef.createElement('td');
      td.textContent=String(value);
      tr.append(td);
    }
    rows.append(tr);
  };
  const reset=()=>rows.replaceChildren();
  const goodItems=body=>
    body?.code==='ozon_sku_cards_lookup'&&body.readOnly===true&&
    body.changedRecords===0&&
    body.source==='ozon_seller_api_v3_product_info_list'&&
    body.accountScope==='connected_ozon_client_only'&&
    Number.isSafeInteger(body.missingFromLocalCatalog)&&
    Number.isSafeInteger(body.attemptedCount)&&
    Number.isSafeInteger(body.foundCount)&&
    body.attemptedCount>=body.foundCount&&
    Array.isArray(body.items)&&Array.isArray(body.notFound)&&
    Array.isArray(body.unsupported)&&
    body.foundCount===body.items.length&&
    body.items.length+body.notFound.length===body.attemptedCount&&
    body.missingFromLocalCatalog===body.attemptedCount+body.unsupported.length;
  async function load(){
    if(busy)return;
    if(windowRef.location?.hash?.split('/')[0]!=='#wbFinance'){
      status.textContent='Открой раздел Финансы WB для сверки карточек.';
      return;
    }
    busy=true;button.disabled=true;
    status.textContent='Один запрос к Ozon Seller API. Проверяем только SKU, отсутствующие в локальном справочнике…';
    reset();
    try{
      const response=await fetchData('/api/finance/ozon-sku-cards',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)
      });
      let data;
      try{data=await response.json();}
      catch{throw Error('ozon_seller_api_invalid_response');}
      if(!response.ok)throw Error(data?.code||'ozon_sku_lookup_unavailable');
      if(!goodItems(data))throw Error('ozon_seller_api_invalid_response');
      for(const item of data.items){
        if(typeof item.sku!=='string'||typeof item.name!=='string'||
          typeof item.offerId!=='string'||item.physicalIdentityVerified!==false||
          item.costTransferred!==false)
          throw Error('ozon_seller_api_invalid_response');
        row([item.sku,item.name,item.offerId,
          item.archived?'В архиве Ozon':'Найдена в подключённом кабинете']);
      }
      for(const sku of data.notFound)
        row([sku,'Нет карточки в подключённом кабинете','—',
          'Не сопоставлять автоматически']);
      for(const sku of data.unsupported)
        row([sku,'SKU не является числовым идентификатором Ozon','—',
          'Нужна отдельная проверка источника']);
      status.textContent='Проверено '+data.attemptedCount+' числовых SKU: найдено '+
        data.foundCount+', отсутствуют в подключённом кабинете '+
        data.notFound.length+', без числового идентификатора '+
        data.unsupported.length+'. Версия Ozon Profit: '+data.profitVersion+
        '. Названия и артикулы получены напрямую из Ozon; это не подтверждённые связи с WB и не новые записи себестоимости.';
      if(!data.items.length&&!data.notFound.length&&!data.unsupported.length){
        row(['—','Нет отсутствующих SKU для запроса','—','Ничего не изменено']);
      }
    }catch(error){
      reset();
      status.textContent=MESSAGES[error?.message]||
        'Не удалось безопасно прочитать карточки Ozon. Существующая себестоимость не изменена.';
    }finally{
      busy=false;button.disabled=false;
    }
  }
  button.addEventListener('click',()=>{void load();});
  return true;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')
  attachOzonSkuLookup();
