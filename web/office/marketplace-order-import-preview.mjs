// Explicit owner-triggered DRY RUN. No marketplace or MoySklad writes.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const ozon=el('marketplaceOrderCheckOzon'),fbo=el('marketplaceOrderCheckFbo'),
    wb=el('marketplaceOrderCheckWb');
  const status=el('marketplaceOrderCheckStatus'),table=el('marketplaceOrderCheckTable');
  const rows=el('marketplaceOrderCheckRows');
  const login=el('marketplaceOrderLogin');
  const perSource={ozon:el('marketplaceOrderStatusOzon'),
    ozon_fbo:el('marketplaceOrderStatusFbo'),
    wb:el('marketplaceOrderStatusWb')};
  if(!ozon||!fbo||!wb||!status||!table||!rows)return;
  let busy=false;
  const setSource=(source,message)=>{
    const node=perSource[source];
    if(node)node.textContent=message;
  };
  const valid=d=>d?.code==='marketplace_order_import_preview_ok'&&
    ['ozon','ozon_fbo','wb'].includes(d.source)&&d.readOnly===true&&
    d.changedRecords===0&&d.approvedForWrite===false&&
    d.coverage===(d.source==='ozon_fbo'?
      'FBO_FIRST_PAGE_LAST_7_DAYS_NOT_PRODUCTION_QUEUE':
      d.source==='ozon'?
      'FBS_AWAITING_PACKAGING_FIRST_PAGE_LAST_7_DAYS':
      'FBS_NEW_FIRST_PAGE_ONLY_NOT_ALL_MARKETPLACE_ORDERS')&&
    Array.isArray(d.orders)&&d.orders.length<=10&&
    Number.isSafeInteger(d.counts?.received)&&
    d.counts.received===d.orders.length&&
    Number.isSafeInteger(d.counts.candidateNeedsInventory)&&
    Number.isSafeInteger(d.counts.notForSewing)&&
    Number.isSafeInteger(d.counts.statusUnverified)&&
    d.counts.candidateNeedsInventory+d.counts.notForSewing+
      d.counts.statusUnverified===d.counts.received&&
    d.orders.every(x=>x.source===d.source&&
      ['candidate_needs_inventory','not_for_sewing','unverified']
        .includes(x.productionQueue)&&
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
    busy=true;ozon.disabled=true;fbo.disabled=true;wb.disabled=true;rows.replaceChildren();
    if(login)login.hidden=true;
    setSource(source,'Проверяем заказы и дубли…');
    table.hidden=true;
    status.textContent='Проверяем '+(source==='ozon'?'Ozon FBS':
      source==='ozon_fbo'?'Ozon FBO':'Wildberries')+
      ' и наличие совпадений в «МойСклад»…';
    try{
      const res=await fetch('/api/marketplace/order-import-preview?source='+source,{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(150000)});
      const data=await res.json();
      if(!res.ok){
        if(res.status===401||data?.code==='owner_session_required'){
          const message='Сессия владельца истекла или вход не выполнен. '+
            'Войдите через Google и повторите проверку. '+
            'Подключения Ozon/WB не проверялись, документы не создавались.';
          status.textContent=message;setSource(source,message);
          if(login)login.hidden=false;
          return;
        }
        if(res.status===403||data?.code==='owner_only'){
          const message='Вход выполнен, но аккаунт не имеет прав владельца. '+
            'Используйте разрешённый Google-аккаунт. '+
            'Запросы к маркетплейсу не выполнялись.';
          status.textContent=message;setSource(source,message);
          if(login)login.hidden=false;
          return;
        }
        if(data?.code==='owner_auth_unavailable'){
          const message='Проверка входа владельца сейчас недоступна. '+
            'Это ошибка авторизации онлайн-офиса, не API маркетплейса.';
          status.textContent=message;setSource(source,message);
          return;
        }
        const label={
          token_rejected:'Ключ API отклонён',
          permission_denied:'Недостаточно прав у ключа API',
          rate_limited:'Достигнут лимит запросов API',
          unexpected_order_feed:'Формат ответа заказов изменился',
          unexpected_order_lines:'Неполные товарные позиции',
          unmapped_order_line:'Не определён артикул или количество',
          duplicate_source_order:'Повтор идентификатора в ответе',
          moysklad_lookup_unverified:'Не удалось однозначно проверить дубли',
          upstream_invalid_json:'API вернул некорректный JSON',
          upstream_response_too_large:'Ответ превышает безопасный лимит',
          upstream_body_missing:'API вернул пустое тело ответа',
          invalid_external_order_identity:'Формат номера заказа не прошёл проверку',
          external_order_key_too_long:'Слишком длинный внешний идентификатор',
          source_error:'API вернул ошибку запроса',
          ozon_status_filter_unverified:'Ozon не подтвердил фильтр новых заказов'
        }[data?.code]||'Ответ источника не удалось проверить';
        const sourceName=data?.stage==='moysklad'?'МойСклад':'маркетплейс';
        const result='Источник ошибки: '+sourceName+'. '+label+
          (Number.isInteger(data?.upstreamHttp)?
            ' · HTTP '+data.upstreamHttp:'')+
          '. Код: '+(typeof data?.code==='string'?data.code:'unknown')+
          '. Документы не создавались.';
        status.textContent=result;setSource(source,result);
        return;
      }
      if(!valid(data))throw Error('preview_unverified');
      for(const order of data.orders){
        const tr=document.createElement('tr');
        cell(tr,order.externalKey);
        cell(tr,order.status+
          (order.productionQueue==='not_for_sewing'?' · не запускать пошив':
            order.productionQueue==='candidate_needs_inventory'?
              ' · нужен контроль остатков':' · назначение не определено'));
        cell(tr,order.items.map(p=>p.sku+' × '+p.quantity).join('; '));
        cell(tr,order.duplicateStatus==='already_exists'?'Точное совпадение найдено':
          order.duplicateStatus==='not_found'?'Не найден точным фильтром · запись выключена':
          order.duplicateLookup==='bounded_list_scan'?
            'Не найден в просмотренной части реестра · дубль не исключён':
            'Не подтверждено');
        rows.append(tr);
      }
      table.hidden=!data.orders.length;
      setSource(source,(source==='ozon_fbo'?
        'Заказы со склада Ozon FBO (за 7 дней): ':
        source==='ozon'?
        'Новые FBS-заказы на сборку (за 7 дней): ':
        'Новые сборочные задания WB: ')+data.counts.received+
        '. Потенциально требуют проверки остатков: '+
        data.counts.candidateNeedsInventory+
        '; не направлять в пошив: '+data.counts.notForSewing+
        '; неясный статус: '+data.counts.statusUnverified+
        '. Неопределённых дублей: '+data.counts.uncertain+
        '. Запись отключена.');
      status.textContent='Проверка выполнена: '+data.counts.received+
        ' заказов в ограниченной выборке. В «МойСклад» уже есть: '+
        data.counts.existing+', не найдены: '+data.counts.notFound+
        ', не подтверждены: '+data.counts.uncertain+
        '. По «МойСклад» просмотрено '+(data.duplicateScan?.checkedRows||0)+
        ' заказов в '+(data.duplicateScan?.pages||0)+' страницах.'+
        (data.duplicateScan?.complete===true?
          ' Обход ограниченного реестра завершён.':
          ' Полный реестр не подтверждён — отсутствие дублей не доказано.')+
        (data.duplicateLookupFailure?
          ' Ошибка доступа к списку заказов'+
          (Number.isInteger(data.duplicateLookupFailure.http)?
            ' (HTTP '+data.duplicateLookupFailure.http+')':'')+
          (Number.isSafeInteger(data.duplicateLookupFailure.upstreamCode)?
            ', код «МойСклад» '+data.duplicateLookupFailure.upstreamCode:'')+
          '.':'')+
        ' Документы не созданы, ассортимент и юридические лица не сверены.';
    }catch{
      const result='Сервис недоступен или ответ не прошёл проверку. '+
        'Операция только на чтение; импорт не выполнялся.';
      status.textContent=result;setSource(source,result);
    }finally{busy=false;ozon.disabled=false;fbo.disabled=false;wb.disabled=false;}
  }
  ozon.addEventListener('click',()=>void load('ozon'));
  fbo.addEventListener('click',()=>void load('ozon_fbo'));
  wb.addEventListener('click',()=>void load('wb'));
})();
