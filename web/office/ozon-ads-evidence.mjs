// Owner-only diagnostic for Ozon Performance Ads. Never changes P&L amounts.
export function describeOzonAdsEvidence(data,month){
  if(data?.code!=='ozon_ads_office_preview'||
    data.month!==month||data.source!=='OZON_PERFORMANCE_API'||
    data.readOnly!==true||data.changedRecords!==0||
    !Number.isSafeInteger(data.recordCount)||data.recordCount<0||
    data.totalExpenseKopecks!==null||
    data.monetaryTotalsVerified!==false||
    data.reconciledToFinance!==false)
    throw Error('unverified_ads_source');
  const a=data.financeAudit;
  if(!a||a.month!==month||a.source!=='ozon_accruals_export'||
    !Number.isSafeInteger(a.accrualRows)||a.accrualRows<0||
    !Number.isSafeInteger(a.advertisingRows)||a.advertisingRows<0||
    !Number.isSafeInteger(a.advertisingAccrualKopecks)||
    a.advertisingRows>a.accrualRows||a.matchedToPerformance!==false||
    a.reconciled!==false)
    throw Error('unverified_finance_audit');
  const amount=(Math.abs(a.advertisingAccrualKopecks)/100)
    .toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
  const last=a.lastDate||'нет дат';
  return 'Ozon Performance API: '+data.recordCount+' строк за '+month+
    '. Отдельный источник D1 (ozon_accruals_export): '+
    a.advertisingRows+' рекламных строк из '+a.accrualRows+
    ' начислений, сумма '+(a.advertisingAccrualKopecks<0?'-':'')+
    amount+' ₽, последняя дата '+last+
    '. Источники имеют разную детализацию и пока НЕ СВЕРЕНЫ. '+
    'Это не сумма расходов Performance API. Реклама повторно из прибыли не вычитается.';
}
export function attachOzonAdsEvidence({documentRef=document,fetcher=fetch,locationRef=location}={}){
  const status=documentRef.getElementById('profitOzonAdsApiStatus');
  const button=documentRef.getElementById('profitOzonAdsApiRefresh');
  const monthInput=documentRef.getElementById('profitMonth');
  if(!status||!button||!monthInput)return false;
  let inFlight=false;
  async function refresh(){
    if(inFlight)return;
    const month=monthInput.value;
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){
      status.textContent='Выберите месяц для проверки Ozon Ads.';return;
    }
    inFlight=true;button.disabled=true;
    status.textContent='Проверяем Ozon Ads через сервер онлайн-офиса…';
    try{
      const res=await fetcher('/api/ozon/ads-expense?month='+encodeURIComponent(month),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)
      });
      const data=await res.json();
      if(!res.ok){
        const reasons={
          unauthorized:'Требуется войти в аккаунт владельца.',
          forbidden:'Нет доступа владельца.',
          ads_bridge_secret_missing:'Сервер Pages не получил ADS_READ_TOKEN. Проверьте Production и новый деплой.',
          ads_bridge_secret_too_short:'ADS_READ_TOKEN доступен Pages, но его длина меньше 32 символов. Проверьте значение секрета.',
          ads_bridge_token_rejected:'Секреты Pages и Worker не совпадают.',
          ozon_ads_finance_audit_unavailable:'Не удалось проверить начисления Ozon в D1: суммы не подтверждены.',
          ozon_expense_schema_unverified:'Ответ Ozon получен, но формат расходов требует проверки.',
          ozon_ads_source_unavailable:'Ozon Ads не отвечает. Требуется проверка соединения.',
          ads_service_binding_missing:'Работающий деплой Pages не видит Service Binding OZON_ADS_WORKER. Проверьте Production и повторную публикацию после создания привязки.',
          ozon_ads_transport_failure:'Не удалось вызвать Ozon Ads через внутреннюю Service Binding. Проверьте привязку и Worker.',
          ozon_ads_binding_entrypoint_error:'Cloudflare отклонил вызов обработчика Service Binding. Требуется исправить Entrypoint привязки.',
          ozon_ads_binding_network_error:'Ошибка сетевого соединения Service Binding внутри Cloudflare.',
          ozon_ads_binding_type_error:'Ошибка типа при вызове Service Binding. Требуется проверить обработчик Worker.',
          ozon_ads_worker_route_not_found:'Cloudflare не нашёл маршрут /api/internal/expense в Ozon Ads Worker. Проверьте опубликованную версию.',
          ozon_ads_worker_rate_limited:'Cloudflare ограничил вызовы рекламного Worker.',
          ozon_ads_worker_http_error:'Worker Ozon Ads ответил серверной ошибкой; проверьте его журнал событий.',
          private_access_not_configured:'В рекламном Worker не настроен защитный токен.',
          ozon_credentials_missing:'Рекламный Worker не получил ключи Ozon Performance.',
          ozon_performance_auth_rejected:'Ozon отклонил Client ID или Client Secret рекламного API (401/403).',
          ozon_performance_token_unavailable:'Ozon не выдал OAuth-токен. Проверьте API Ozon и статус сервисного аккаунта.',
          ozon_performance_token_unrecognized:'Ответ Ozon при получении OAuth-токена имеет неизвестный формат.',
          ozon_performance_expense_unauthorized:'Ozon отклонил доступ к статистике расходов (401/403).',
          ozon_performance_rate_limited:'Ozon ограничил частоту запросов. Не повторяйте запросы часто.',
          ozon_performance_expense_unavailable:'Метод расходов Ozon вернул ошибку. Требуется проверить метод и параметры.',
          ozon_performance_network_or_schema_error:'Не удалось получить или разобрать ответ рекламного Ozon API.',
          ozon_expense_schema_unverified:'Ответ Ozon получен, но структура статистики пока не распознана.',
          ozon_expense_rows_unrecognized:'Ozon вернул строки расходов неизвестного формата.',
          invalid_closed_month:'Выберите полностью завершённый месяц.'
        };
        const reason=reasons[data?.code]||
          'Сверка Ozon Ads не выполнена. Источник данных недоступен.';
        const safePhase=['request_setup','service_binding_fetch','upstream_response','upstream_json']
          .includes(data?.phase)?data.phase:null;
        status.textContent=reason+(safePhase?' Этап: '+safePhase+'.':'');
        return;
      }
      // Data may have changed month during the request.
      if(monthInput.value!==month)return;
      status.textContent=describeOzonAdsEvidence(data,month);
    }catch{
      status.textContent='Подключение рекламы Ozon не подтверждено. Не считать расходы нулевыми.';
    }finally{inFlight=false;button.disabled=false;}
  }
  button.addEventListener('click',refresh);
  return true;
}
if(typeof window!=='undefined'&&typeof document!=='undefined')
  attachOzonAdsEvidence();
