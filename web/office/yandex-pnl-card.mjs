// Display-only card selector. The audited Yandex order-margin income is NOT
// a channel contribution and NEVER participates in consolidated profit sums.
export function yandexPnlCardMetric(channel,interim,month){
 // The old 617792.35 RUB and both linked campaigns are unrelated LLC data.
 // The owner confirmed AutoSklad63 finances are IP Zhilina Olga only.
 if(channel?.id==='yandex')return {showIncome:false,
  primaryKopecks:null,meaning:'Нет расчёта ИП Жилиной',
  note:'Стороннее ООО исключено из финансов АвтоСклад63'};

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
  note:'Оба магазина одного ООО · '+y.orders+
   ' заказов. Комиссии уже учтены. Себестоимость, возвраты, налог ООО и общие расходы ещё не выверены.'};
}
