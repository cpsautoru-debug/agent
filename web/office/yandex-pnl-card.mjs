// Presentation only. Direct-cost Yandex contribution takes priority over
// revenue when verified SKU evidence exists. Neither means net profit.
export function yandexPnlCardMetric(channel,interim,month){
 const y=interim?.yandex;
 const ready=channel?.id==='yandex'&&y?.month===month&&
  Number.isSafeInteger(y?.incomeKopecks)&&
  Number.isSafeInteger(y?.orders)&&y.orders>0;
 const snapshot=interim?.yandexCost;
 const costReady=channel?.id==='yandex'&&
  channel.status==='known_cost_result'&&
  Number.isSafeInteger(channel.profitKopecks)&&
  snapshot?.month===month&&
  snapshot.status==='preliminary_cost_reconciled'&&
  snapshot.netProfitKopecks===null&&
  channel.profitKopecks===snapshot.preliminaryContributionKopecks;
 if(costReady)return {showIncome:ready,
  primaryKopecks:channel.profitKopecks,
  incomeKopecks:ready?y.incomeKopecks:null,
  meaning:'После известной себестоимости · НЕ чистая прибыль',
  orderCount:ready?y.orders:null,
  note:'Себестоимость доставленных SKU учтена. До подтверждения налогов, рекламы, возвратов и остальных затрат это предварительный результат.'};
 if(!ready)return {showIncome:false,
  primaryKopecks:channel?.profitKopecks??null,
  incomeKopecks:null,
  meaning:channel?.status==='known_cost_result'?
   'По известным затратам · не чистая прибыль':
   channel?.status==='verified'?'Подтверждено':'Нет закрытого расчёта'};
 return {showIncome:true,primaryKopecks:y.incomeKopecks,
  incomeKopecks:null,
  meaning:'Доход после услуг · НЕ чистая прибыль',
  orderCount:y.orders,
  note:'Оба магазина ИП Жилиной Ольги · '+y.orders+
   ' заказов. Комиссии уже учтены. Себестоимость, возвраты, налог ИП и общие расходы ещё не выверены.'};
}
