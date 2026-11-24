// Display-only card selector. The audited Yandex order-margin income is NOT
// a channel contribution and NEVER participates in consolidated profit sums.
export function yandexPnlCardMetric(channel,interim,month){
 const y=interim?.yandex;
 const ready=channel?.id==='yandex'&&
  y?.month===month&&
  Number.isSafeInteger(y?.incomeKopecks)&&
  Number.isSafeInteger(y?.orders)&&y.orders>0;
 if(!ready)return {showIncome:false,primaryKopecks:channel?.profitKopecks??null,
  meaning:channel?.status==='known_cost_result'?
   'По известным затратам · не чистая прибыль':
   channel?.status==='verified'?'Подтверждено':'Нет закрытого расчёта'};
 return {showIncome:true,primaryKopecks:y.incomeKopecks,
  meaning:'Доход после услуг · НЕ чистая прибыль',
  orderCount:y.orders,
  note:'Оба магазина ИП Жилиной Ольги · '+y.orders+
   ' заказов. Комиссии уже учтены. Себестоимость, возвраты, налог ИП и общие расходы ещё не выверены.'};
}
