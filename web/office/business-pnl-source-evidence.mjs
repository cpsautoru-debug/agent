// Read-only WB evidence for the CEO dashboard; NOT a contribution margin.
// WB profit must never be inferred from seller payouts.
export function describeDashboardWbEvidence(data,month){
 if(!data||data.code!=='entity_income_evidence'||data.month!==month||
   data.readOnly!==true||data.changedRecords!==0||
   data.distributionReady!==false||data.wb?.taxIncomeConfirmed!==false||
   data.wb?.payoutIsNotTaxRevenue!==true)
   throw Error('wb_income_evidence_invalid');
 const x=data.wb.costCoverage;
 if(!x||!Number.isSafeInteger(x.soldArticles)||
   !Number.isSafeInteger(x.confirmedArticles)||
   !Number.isSafeInteger(x.preliminaryArticles)||
   x.confirmedArticles>x.soldArticles||
   x.preliminaryArticles>x.soldArticles||
   x.complete!==false||
   !Number.isSafeInteger(data.wb.reports)||
   typeof data.wb.reportPeriodComplete!=='boolean')
   throw Error('wb_cost_evidence_invalid');
 return 'Отчётов: '+data.wb.reports+
   '; товаров с подтверждённой себестоимостью: '+
   x.confirmedArticles+' из '+x.soldArticles+
   '; предварительных: '+x.preliminaryArticles+
   '. Период: '+(data.wb.reportPeriodComplete?'покрыт':'неполный')+
   '. Выплаты не равны прибыли.';
}
