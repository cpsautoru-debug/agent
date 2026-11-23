// A read-only independent daily total comparison. This is a control on
// aggregate source amounts, NOT legal/accounting reconciliation of details.
const validKop=x=>Number.isSafeInteger(x);
const validDate=x=>typeof x==='string'&&/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(x);
export function compareOzonDailyTotals(month,xlsxRows,apiDays){
  if(typeof month!=='string'||!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month)||
    !Array.isArray(xlsxRows)||xlsxRows.length>100000||
    !Array.isArray(apiDays)||apiDays.length>31)
    throw Error('invalid_daily_parity_input');
  const from=new Date(month+'-01T00:00:00Z');
  if(!Number.isFinite(from.getTime()))throw Error('invalid_daily_parity_input');
  const next=new Date(from);next.setUTCMonth(next.getUTCMonth()+1);
  const expected=(next-from)/86400000;
  const days=new Map(),reportSums=new Map(),reportSigns=new Map();
  for(let i=0;i<expected;i++){
    const d=new Date(from.getTime()+i*86400000).toISOString().slice(0,10);
    reportSums.set(d,0);
    reportSigns.set(d,{positiveKop:0,negativeKop:0,rows:0});
  }
  for(const row of xlsxRows){
    if(!row||!validDate(row.date)||!reportSums.has(row.date)||
      !validKop(row.amountKopecks))throw Error('invalid_daily_xlsx_row');
    const next=reportSums.get(row.date)+row.amountKopecks;
    if(!validKop(next))throw Error('invalid_daily_sum');
    reportSums.set(row.date,next);
    const sign=reportSigns.get(row.date);
    const key=row.amountKopecks>0?'positiveKop':'negativeKop';
    sign[key]+=row.amountKopecks;
    sign.rows++;
    if(!validKop(sign[key])||!Number.isSafeInteger(sign.rows))
      throw Error('invalid_daily_sum');
  }
  for(const row of apiDays){
    if(!row||!validDate(row.date)||!reportSums.has(row.date)||
      days.has(row.date)||!validKop(row.totalKopecks)||
      row.complete!==true)throw Error('invalid_daily_api_row');
    days.set(row.date,row.totalKopecks);
  }
  // Comparing positive/negative splits is a diagnostic only: XLSX service
  // lines and API accrual envelopes have different granularity, so a
  // difference is not proof of missing money or an erroneous report.
  const granularity=[];
  for(const [date,sign] of reportSigns){
    const api=days.get(date);
    if(!api||!validKop(api.positiveKopecks)||
      !validKop(api.negativeKopecks)||!Number.isSafeInteger(api.recordCount))
      continue;
    if(sign.positiveKop!==api.positiveKopecks||
      sign.negativeKop!==api.negativeKopecks||
      sign.rows!==api.recordCount)
      granularity.push({
        date,xlsxRows:sign.rows,apiOperations:api.recordCount,
        xlsxPositiveKop:sign.positiveKop,
        apiPositiveKop:api.positiveKopecks,
        xlsxNegativeKop:sign.negativeKop,
        apiNegativeKop:api.negativeKopecks
      });
  }
  const gaps=[...reportSums].filter(([day,xlsx])=>
    !days.has(day)||days.get(day)!==xlsx).map(([day,xlsx])=>({
      date:day,
      differenceKop:days.has(day)?xlsx-days.get(day):null
    }));
  return {code:'ozon_daily_totals_parity',readOnly:true,
    checkedDays:days.size,expectedDays:expected,
    matchedDays:expected-gaps.length,
    match:days.size===expected&&gaps.length===0,
    discrepancies:gaps.slice(0,10),
    granularity:{
      comparability:'XLSX_SERVICE_LINES_VS_API_ACCRUAL_ENVELOPES',
      comparedDays:apiDays.filter(x=>Number.isSafeInteger(x.recordCount)&&
        validKop(x.positiveKopecks)&&validKop(x.negativeKopecks)).length,
      differingDays:granularity.length,
      examples:granularity.slice(0,3),
      absenceOfDifferenceDoesNotVerifyDetail:true
    },
    officialDetailReconciled:false,changedRecords:0};
}
