// Explicit owner-triggered DRY RUN. No marketplace or MoySklad writes.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const ozon=el('marketplaceOrderCheckOzon'),fbo=el('marketplaceOrderCheckFbo'),
    wb=el('marketplaceOrderCheckWb');
  const status=el('marketplaceOrderCheckStatus');
  const tables={
    ozon:el('marketplaceOrderCheckTableOzon'),
    ozon_fbo:el('marketplaceOrderCheckTableFbo'),
    wb:el('marketplaceOrderCheckTableWb')
  };
  const rowSets={
    ozon:el('marketplaceOrderCheckRowsOzon'),
    ozon_fbo:el('marketplaceOrderCheckRowsFbo'),
    wb:el('marketplaceOrderCheckRowsWb')
  };
  const login=el('marketplaceOrderLogin');
  const diagnose=el('marketplaceMsDiagnose');
  const diagnostic=el('marketplaceMsDiagnosticStatus');
  const perSource={ozon:el('marketplaceOrderStatusOzon'),
    ozon_fbo:el('marketplaceOrderStatusFbo'),
    wb:el('marketplaceOrderStatusWb')};
  if(!ozon||!fbo||!wb||!status||
    Object.values(tables).some(x=>!x)||
    Object.values(rowSets).some(x=>!x))return;
  let busy=false;
  const setSource=(source,message)=>{
    const node=perSource[source];
    if(node)node.textContent=message;
  };
  const valid=d=>d?.code==='marketplace_order_import_preview_ok'&&
    ['ozon','ozon_fbo','wb'].includes(d.source)&&d.readOnly===true&&
    d.changedRecords===0&&d.approvedForWrite===false&&
    d.coverage===(d.source==='ozon_fbo'?
      'FBO_LAST_7_DAYS_COMPLETE_NOT_FOR_SEWING':
      d.source==='ozon'?
      'FBS_PACKAGING_AND_AWAITING_DELIVER_LAST_30_DAYS_COMPLETE':
      'WB_NEW_FBS_ORDERS_API_SNAPSHOT')&&
    d.complete===true&&Array.isArray(d.orders)&&d.orders.length<=200&&
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
        p.quantity>0&&
        ['matched_exact_article','matched_exact_code','matched_exact_barcode','not_matched','unverified']
          .includes(p.assortmentMatch)&&
        (d.source==='wb'||(p.ozonCatalog&&
          ['not_confirmed','ambiguous','seller_product_with_barcode',
            'seller_product_without_barcode'].includes(p.ozonCatalog.status)&&
          Array.isArray(p.ozonCatalog.barcodes)&&
          p.ozonCatalog.barcodes.length<=4)))&&
      ['already_exists','not_found','unverified'].includes(x.duplicateStatus));
  const cell=(tr,value)=>{const td=document.createElement('td');
    td.textContent=value;tr.append(td);};
  async function load(source){
    if(busy)return;
    busy=true;ozon.disabled=true;fbo.disabled=true;wb.disabled=true;
    const rows=rowSets[source],table=tables[source];
    rows.replaceChildren();table.hidden=true;
    if(login)login.hidden=true;
    setSource(source,'Проверяем заказы и дубли…');
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
        cell(tr,order.items.map(p=>{
          if(!p.ozonCatalog)return 'Не применяется к WB';
          const v=p.ozonCatalog;
          return v.status==='ambiguous'?'Неоднозначная карточка Ozon':
            v.status==='not_confirmed'?'Карточка Ozon не подтверждена':
            v.status==='seller_product_without_barcode'?
              'Артикул Ozon подтверждён, штрихкод отсутствует':
              'Штрихкод Ozon: '+v.barcodes.join(', ')+
              (v.productId?' · ID '+v.productId:'');
        }).join('; '));
        cell(tr,order.items.map(p=>
          p.assortmentMatch==='matched_exact_article'?
            p.sku+' — точный артикул найден':
          p.assortmentMatch==='matched_exact_code'?
            p.sku+' — точный код товара найден':
          p.assortmentMatch==='matched_exact_barcode'?
            p.sku+' — точно найден по штрихкоду':
          p.assortmentMatch==='not_matched'?
            p.sku+' — нет точного совпадения ни по артикулу, ни по коду':
            p.sku+' — сопоставление не подтверждено').join('; '));
        cell(tr,order.duplicateStatus==='already_exists'?'Точное совпадение найдено':
          order.duplicateStatus==='not_found'?
            'Не найден по новому ID интеграции · старые дубли возможны':
          order.duplicateLookup==='bounded_list_scan'?
            'Не найден в просмотренной части реестра · дубль не исключён':
            'Не подтверждено');
        rows.append(tr);
      }
      table.hidden=!data.orders.length;
      const sellerEvidence=source==='wb'?'':(
        ' Карточки Ozon по API: '+
        (Number.isSafeInteger(data.ozonProductLookup?.productsConfirmed)?
          data.ozonProductLookup.productsConfirmed:0)+
        ', статус: '+({
          ok:'данные получены',
          empty:'нет товаров в выборке',
          permission_denied:'недостаточно прав',
          rate_limited:'лимит API',
          request_rejected:'ошибка формата запроса',
          schema_unverified:'неподтверждённая структура ответа',
          source_unavailable:'API карточек недоступен'
        }[data.ozonProductLookup?.status]||'неизвестно')+'.');
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
        '.'+sellerEvidence+' Запись отключена.');
      status.textContent='Проверка выполнена: '+data.counts.received+
        ' заказов в ограниченной выборке. Точных совпадений по ID интеграции: '+
        data.counts.existing+', без совпадения по новому ID: '+data.counts.notFound+
        ', не подтверждены: '+data.counts.uncertain+
        '. По «МойСклад» просмотрено '+(data.duplicateScan?.checkedRows||0)+
        ' заказов в '+(data.duplicateScan?.pages||0)+' страницах.'+
        (data.duplicateScan?.complete===true?
          ' Обход ограниченного реестра завершён.':
          ' Полный реестр не подтверждён — отсутствие дублей не доказано.')+
        (data.barcodeLookup&&Number.isSafeInteger(data.barcodeLookup.requests)?
          ' Штрихкоды: проверено '+data.barcodeLookup.requests+
          ' уникальных SKU, подтверждено '+
          (Array.isArray(data.barcodeLookup.diagnostics)?
            data.barcodeLookup.diagnostics.filter(x=>x.category==='one_exact').length:0)+'.'+
          (Array.isArray(data.barcodeLookup.diagnostics)?
            ' Диагностика: '+data.barcodeLookup.diagnostics.slice(0,2).map(x=>{
              const labels={
                one_exact:'одно точное совпадение',
                absent_exact:'в «МойСклад» такой штрихкод не найден',
                filter_rejected:'фильтр штрихкода не поддержан',
                rate_limited:'достигнут лимит API',
                permission_denied:'нет прав',
                source_unavailable:'ответ недоступен',
                unverified:'совпадение не подтверждено'
              };
              return String(x.sku).slice(0,100)+': '+
                (labels[x.category]||'неизвестный результат');
            }).join('; ')+'.':'')+
          (data.barcodeLookup.rateLimited?' Проверка остановлена из-за лимита.':''):
          '')+
        (data.nameSuggestion&&data.nameSuggestion.sku?
          ' Поиск возможных карточек по названию для SKU '+
          String(data.nameSuggestion.sku).slice(0,100)+': '+
          ({
            possible_candidates:'найдены варианты для проверки',
            none_in_search:'вариантов в поиске нет',
            no_usable_query:'название нельзя использовать для поиска',
            rate_limited:'ограничение API',
            search_rejected:'поиск отклонён API',
            permission_denied:'нет доступа',
            unverified_response:'формат ответа не подтверждён',
            source_unavailable:'источник недоступен'
          }[data.nameSuggestion.status]||'не подтверждено')+
          (Array.isArray(data.nameSuggestion.candidates)&&
            data.nameSuggestion.candidates.length?
            ' — '+data.nameSuggestion.candidates.slice(0,3)
              .filter(x=>typeof x?.name==='string')
              .map(x=>x.name.slice(0,130)).join('; '):'')+
          '. Это только кандидаты, автоматическое сопоставление запрещено.':'')+
        (data.assortmentCoverage?.mode==='TARGETED_ONLY_TO_AVOID_RATE_LIMITS'?
          (data.assortmentCoverage.exactQueries>0?
            ' Дополнительные проверки артикула/кода: '+
            data.assortmentCoverage.exactQueries+'.':
            ' Дополнительные проверки артикула/кода не выполнялись: сначала проверяются штрихкоды.'):
          ' Ассортимент «МойСклад»: просмотрено '+
            (data.assortmentCoverage?.checkedRows||0)+' позиций, '+
            (data.assortmentCoverage?.pages||0)+' страниц'+
            (data.assortmentCoverage?.complete===true?
              ' · полный обход.':' · обход неполный, SKU нельзя считать отсутствующим.'))+
        (Number.isSafeInteger(data.assortmentCoverage?.confirmedByFilter)&&
          data.assortmentCoverage.confirmedByFilter>0?
          ' Точно подтверждено по отдельным запросам: '+
            data.assortmentCoverage.confirmedByFilter+' SKU.':'')+
        (Array.isArray(data.assortmentCoverage?.exactDiagnostics)?
          ' Точечная диагностика: '+
          data.assortmentCoverage.exactDiagnostics.slice(0,8).map(e=>{
            const label={
              not_checked:'не проверено',
              absent_exact:'нет точного совпадения',
              one_exact:'одно точное совпадение',
              ambiguous:'несколько совпадений',
              filter_rejected:'фильтр отклонён API',
              permission_denied:'доступ запрещён',
              rate_limited:'лимит API',
              response_too_large:'слишком большой ответ',
              schema_unverified:'ответ не подтверждён',
              source_unavailable:'источник недоступен'
            };
            return String(e.sku).slice(0,100)+' (артикул: '+
              (label[e.article]||'неизвестно')+', код: '+
              (label[e.code]||'неизвестно')+')';
          }).join('; ')+'.':'')+
        (data.assortmentCoverage?.sourceError===true?
          ' Причина: '+({
            response_too_large:'слишком большой ответ API',
            rate_limited:'лимит запросов API',
            token_rejected:'токен отклонён',
            permission_denied:'нет доступа к ассортименту',
            upstream_http_error:'ошибка HTTP от API',
            response_unavailable:'ответ API недоступен',
            schema_unverified:'структура ответа не подтверждена',
            size_changed:'размер каталога изменился при обходе',
            short_page:'неполная промежуточная страница'
          }[data.assortmentCoverage.failureCode]||'неизвестная')+'.':'')+
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
  async function checkMoyskladOrders(){
    if(!diagnose||!diagnostic||busy)return;
    diagnose.disabled=true;
    diagnostic.textContent='Проверяем доступность заказов покупателей «МойСклад»…';
    try{
      const res=await fetch('/api/marketplace/moysklad-order-diagnostic',{
        credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(45000)
      });
      const data=await res.json();
      if(res.status===401||data?.code==='owner_session_required'){
        diagnostic.textContent='Истекла сессия владельца. Войдите через Google.';
        if(login)login.hidden=false;
        return;
      }
      if(!res.ok||data?.code!=='moysklad_orders_diagnostic_ok'||
        data.readOnly!==true||data.changedRecords!==0||
        data.approvedForWrite!==false||
        data.meaning!=='HTTP_ONLY_NO_CUSTOMER_ORDER_DATA_NO_DUPLICATE_CLEARANCE'||
        !Array.isArray(data.results)||data.results.length>4)
        throw Error('invalid_diagnostic');
      const labels={
        customerorder_default:'Заказы покупателей (без offset)',
        customerorder_offset_zero:'Заказы покупателей (offset=0)',
        productiontask_control:'Производственные задания (контроль)',
        assortment_catalog:'Ассортимент (контроль API)'
      };
      const safe=data.results.every(item=>
        Object.hasOwn(labels,item?.probe)&&
        (item.http===null||(Number.isInteger(item.http)&&
          item.http>=100&&item.http<=599))&&
        (item.errorCode===null||
          (Number.isSafeInteger(item.errorCode)&&item.errorCode>=0))&&
        typeof item.networkError==='boolean');
      if(!safe)throw Error('unverified_diagnostic');
      diagnostic.textContent=data.results.map(item=>
        labels[item.probe]+': '+
        (item.networkError?'нет ответа':
          'HTTP '+item.http)+
        (item.errorCode!==null?' · код «МойСклад» '+item.errorCode:'')
      ).join(' | ')+
        '. Только чтение, данные клиентов не загружены в интерфейс.';
    }catch{
      diagnostic.textContent='Не удалось получить подтверждённую диагностику API «МойСклад». Запись отключена.';
    }finally{diagnose.disabled=false;}
  }
  if(diagnose&&diagnostic)
    diagnose.addEventListener('click',()=>void checkMoyskladOrders());
  ozon.addEventListener('click',()=>void load('ozon'));
  fbo.addEventListener('click',()=>void load('ozon_fbo'));
  wb.addEventListener('click',()=>void load('wb'));
})();
