// Strict visual adapter for the owner-only WB monthly finance calculation.
const safe=Number.isSafeInteger;
export function validateDashboardWbMonth(data,month){
 if(!data||data.code!=='wb_month_settlement'||
   data.month!==month||data.source!=='WB_FINANCE_API_D1'||
   data.readOnly!==true||data.changedRecords!==0||
   data.reportPeriodCovered!==true||
   data.settlementReconciled!==true||data.profitVerified!==false||
   data.manufacturingCostKopecks!==null||
   data.contributionKopecks!==null||data.netProfitKopecks!==null||
   !safe(data.reports)||data.reports<1||
   !safe(data.rows)||data.rows<1||
   !safe(data.soldArticles)||data.soldArticles<0||
   !safe(data.confirmedCostArticles)||data.confirmedCostArticles<0||
   data.confirmedCostArticles>data.soldArticles||
   !safe(data.preliminaryCostArticles)||
   !safe(data.expectedDays)||data.expectedDays<28||data.expectedDays>31)
   throw Error('wb_month_evidence_not_reconciled');
 const fields=['productPayoutKopecks','returnsKopecks','platformFeesKopecks',
  'deliveryKopecks','storageKopecks','deductionsKopecks',
  'penaltyKopecks','afterWbChargesKopecks'];
 if(fields.some(k=>!safe(data[k]))||
   data.platformFeesKopecks!==
    data.deliveryKopecks+data.storageKopecks+
    data.deductionsKopecks+data.penaltyKopecks||
   data.afterWbChargesKopecks!==
    data.productPayoutKopecks-data.returnsKopecks-
    data.platformFeesKopecks)
   throw Error('wb_month_amount_mismatch');
 return {amountKopecks:data.afterWbChargesKopecks,
  reports:data.reports,rows:data.rows,
  soldArticles:data.soldArticles,
  confirmedCostArticles:data.confirmedCostArticles,
  preliminaryCostArticles:data.preliminaryCostArticles,
  breakdown:[
   ['Продажи (расчётная сумма WB до перечисленных удержаний)',data.productPayoutKopecks],
   ['Возвраты',-data.returnsKopecks],
   ['Доставка WB',-data.deliveryKopecks],
   ['Хранение WB',-data.storageKopecks],
   ['Удержания WB',-data.deductionsKopecks],
   ['Штрафы WB',-data.penaltyKopecks]
  ],
  label:'После удержаний WB, но до себестоимости, внешней рекламы, общих расходов и налогов. НЕ ПРИБЫЛЬ.'};
}
