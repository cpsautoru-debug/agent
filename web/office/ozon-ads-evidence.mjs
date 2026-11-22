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
  return 'Ozon Performance API отвечает. Строк за '+month+': '+
    data.recordCount+'. Расходы пока НЕ СВЕРЕНЫ с начислениями Ozon Finance.'+
    ' Рекламные суммы не прибавляются и не вычитаются из прибыли.';
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
          ads_bridge_secret_missing:'В Pages ещё не добавлен секрет ADS_READ_TOKEN.',
          ads_bridge_token_rejected:'Секреты Pages и Worker не совпадают.',
          ozon_expense_schema_unverified:'Ответ Ozon получен, но формат расходов требует проверки.',
          ozon_ads_source_unavailable:'Рекламный источник сейчас недоступен.',
          invalid_closed_month:'Выберите полностью завершённый месяц.'
        };
        status.textContent=reasons[data?.code]||
          'Сверка Ozon Ads не выполнена. Источник данных недоступен.';
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
