// Conservative, read-only cost evidence from two Yandex realization
// archives and the owner-verified WB/Ozon unit-cost crosswalk.
// Never substitute missing SKUs or amounts with zero, and never equate this
// manufacturing cost with accounting profit or tax-deductible expense.
const HISTORICAL_CAMPAIGNS=[149082506,149106500];
// Owner confirmed: SAD is the only active seller for October 2026 onwards.
// Historical archives for 149106500 remain accessible but do not block current COGS.
export function applicableYandexCampaigns(month){
 return /^20\d{2}-(0[1-9]|1[0-2])$/.test(month)&&month>='2026-10'?
  [149082506]:[...HISTORICAL_CAMPAIGNS];
}
const key=(partnerId,shopSku)=>partnerId+':'+shopSku;
const validMoney=v=>Number.isSafeInteger(v)&&v>0&&v<=100000000;
const validQuantity=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000;
function verifiedSheet(audit,sheetName,quantityField){
 if(audit?.code!=='yandex_report_archive_audited'||
    audit.readOnly!==true||audit.changedRecords!==0||
    !Array.isArray(audit.sheets))
  return {status:'source_not_verified'};
 const sheet=audit.sheets.find(s=>s.sheet===sheetName);
 if(!sheet)return {status:'sheet_missing'};
 if(!Number.isSafeInteger(sheet.rows)||sheet.rows<0||
    sheet.rows>100000||
    !Array.isArray(sheet.realizationSkuSummaries))
  return {status:'sheet_structure_unverified'};
 const coverage=sheet.realizationSkuCoverage;
 if(!coverage||coverage.recognizedRows!==sheet.rows||
    coverage.unmappedRows!==0||coverage.skippedRows!==0||
    coverage.invalidQuantityRows!==0)
  return {status:'sku_coverage_incomplete'};
 const totals=sheet.quantityTotals?.[quantityField];
 if(!totals||totals.present!==sheet.rows||totals.invalid!==0||
   !validQuantity(totals.total))
  return {status:'quantity_coverage_incomplete'};
 const seen=new Set();let sum=0,rowCount=0;
 for(const line of sheet.realizationSkuSummaries){
  if(typeof line.shopSku!=='string'||!line.shopSku||
     line.shopSku.length>150||seen.has(line.shopSku)||
     !validQuantity(line.units)||line.invalid!==0||
     !Number.isSafeInteger(line.rows)||line.rows<1)
   return {status:'sku_totals_invalid'};
  seen.add(line.shopSku);sum+=line.units;rowCount+=line.rows;
 }
 if(sum!==totals.total||rowCount!==sheet.rows||
    !Number.isSafeInteger(sum))
  return {status:'quantity_reconciliation_failed'};
 return {status:'verified',units:totals.total,
  items:sheet.realizationSkuSummaries.map(x=>({
   shopSku:x.shopSku,offerName:String(x.offerName||'').slice(0,200),
   units:x.units
  }))};
}
function auditedCampaign(campaign,audit,rows){
 if(audit?.code==='yandex_report_no_data')
  return {campaignId:campaign,status:'no_data',deliveredUnits:null,
   returnedUnits:null,deliveredCostKopecks:null,returnedValueKopecks:null,
   missing:[]};
 if(!audit)
  return {campaignId:campaign,status:'not_ready',deliveredUnits:null,
   returnedUnits:null,deliveredCostKopecks:null,returnedValueKopecks:null,
   missing:[]};
 const deliveries=verifiedSheet(audit,'delivered.json','deliveredCount');
 const returns=verifiedSheet(audit,'returned.json','returnedCount');
 // Model/fuzzy-family estimates are useful for review but not sufficient
 // to certify the material cost of a particular physical SKU.
 const costs=new Map(rows.filter(x=>x.partnerId===campaign).map(x=>[
  x.shopSku,validMoney(x.costKopecks)&&
   ['matched_exact','matched_owner'].includes(x.status)?
    x.costKopecks:null]));
 const missing=new Map();
 function costUnits(sheet,kind){
  if(sheet.status!=='verified')return {kopecks:null,knownUnits:0,
   unknownUnits:null};
  let total=0,knownUnits=0,unknownUnits=0;
  for(const item of sheet.items){
   const cost=costs.get(item.shopSku);
   if(!cost){
    unknownUnits+=item.units;
    if(item.units>0){
     const k=key(campaign,item.shopSku);
     const x=missing.get(k)||{partnerId:campaign,
      shopSku:item.shopSku,name:item.offerName,
      deliveredUnits:0,returnedUnits:0};
     if(!x.name&&item.offerName)x.name=item.offerName;
     x[kind+'Units']+=item.units;
     missing.set(k,x);
    }
    continue;
   }
   const amount=cost*item.units;
   if(!Number.isSafeInteger(amount)||!Number.isSafeInteger(total+amount))
    return {kopecks:null,knownUnits,unknownUnits:null};
   total+=amount;knownUnits+=item.units;
  }
  return {kopecks:unknownUnits===0?total:null,
   knownValueKopecks:total,knownUnits,unknownUnits};
 }
 const d=costUnits(deliveries,'delivered'),r=costUnits(returns,'returned');
 const complete=deliveries.status==='verified'&&
  returns.status==='verified'&&d.kopecks!==null&&r.kopecks!==null;
 return {campaignId:campaign,
  status:complete?'cost_verified':'cost_incomplete',
  deliveredReportStatus:deliveries.status,returnedReportStatus:returns.status,
  deliveredUnits:deliveries.status==='verified'?deliveries.units:null,
  returnedUnits:returns.status==='verified'?returns.units:null,
  deliveredCostKopecks:d.kopecks,returnedValueKopecks:r.kopecks,
  confirmedDeliveredCostKopecks:d.knownValueKopecks??null,
  confirmedReturnValueKopecks:r.knownValueKopecks??null,
  unknownDeliveredUnits:d.unknownUnits,
  unknownReturnedUnits:r.unknownUnits,
  missing:[...missing.values()]};
}
export function reconcileYandexRealizationCosts(costAudit,reportByCampaign){
 if(!costAudit||!Array.isArray(costAudit.rows)||
    !reportByCampaign||typeof reportByCampaign!=='object')
  throw Error('yandex_realization_inputs_invalid');
 const byShop=applicableYandexCampaigns(costAudit.month).map(id=>
  auditedCampaign(id,reportByCampaign[id],costAudit.rows));
 return {month:costAudit.month,byShop,
  status:byShop.every(x=>x.status==='cost_verified')?
   (costAudit.month>='2026-10'?'active_shops_cost_verified':
    'two_shops_cost_verified'):'reconciliation_incomplete',
  totalDeliveredCostKopecks:byShop.every(x=>
   Number.isSafeInteger(x.deliveredCostKopecks))?
   byShop.reduce((n,x)=>n+x.deliveredCostKopecks,0):null,
  totalReturnedValueKopecks:byShop.every(x=>
   Number.isSafeInteger(x.returnedValueKopecks))?
   byShop.reduce((n,x)=>n+x.returnedValueKopecks,0):null,
  missing:byShop.flatMap(x=>x.missing),
  netProfitKopecks:null,
  note:'Delivered and returned manufacturing-cost values are separate evidence. Returned value is NOT confirmed COGS recovery; tax and other costs are not reconciled.'};
}
export function collectYandexRealizationCandidates(reportByCampaign,month){
 const result=[],seen=new Set();
 for(const campaign of applicableYandexCampaigns(month)){
  const audit=reportByCampaign?.[campaign];
  if(audit?.code!=='yandex_report_archive_audited'||
     audit.readOnly!==true)continue;
  for(const sheet of audit.sheets||[]){
   if(!['delivered.json','returned.json'].includes(sheet.sheet))continue;
   for(const item of sheet.realizationSkuSummaries||[]){
    if(typeof item.shopSku!=='string'||!item.shopSku||
       item.shopSku.length>150)continue;
    const k=key(campaign,item.shopSku);
    if(seen.has(k))continue;
    seen.add(k);
    result.push({partnerId:campaign,shopSku:item.shopSku,
     offerName:String(item.offerName||'').slice(0,200)});
   }
  }
 }
 return result;
}

/**
 * Owner-readable, privacy-bounded SKU ledger for persistent finance review.
 * Contains only seller-offer SKU, title, delivered/returned unit counts and
 * already verified unit-cost status. NO buyer/order/payment identifiers.
 */
export function buildYandexSafeSkuEvidence(costAudit,reportByCampaign){
 if(!costAudit||!Array.isArray(costAudit.rows)||!reportByCampaign)
  throw Error('yandex_sku_evidence_invalid');
 const result=[],issues=[];
 const prices=new Map(costAudit.rows.map(x=>[
  key(x.partnerId,x.shopSku),{
   status:x.status,costKopecks:
    ['matched_exact','matched_owner'].includes(x.status)&&
    validMoney(x.costKopecks)?x.costKopecks:null,
   name:String(x.name||'').slice(0,200)
  }
 ]));
 for(const partnerId of applicableYandexCampaigns(costAudit.month)){
  const audit=reportByCampaign[partnerId];
  if(audit?.code==='yandex_report_no_data'){
   issues.push({partnerId,reason:'source_no_data'});continue;
  }
  if(!audit){issues.push({partnerId,reason:'source_missing'});continue;}
  const delivered=verifiedSheet(audit,'delivered.json','deliveredCount');
  const returned=verifiedSheet(audit,'returned.json','returnedCount');
  for(const [type,sheet] of [['delivered',delivered],['returned',returned]]){
   if(sheet.status!=='verified'){
    issues.push({partnerId,reason:type+'_'+sheet.status});
    continue;
   }
   for(const item of sheet.items){
    const price=prices.get(key(partnerId,item.shopSku));
    let line=result.find(x=>x.partnerId===partnerId&&
     x.shopSku===item.shopSku);
    if(!line){
     if(result.length>=500)throw Error('yandex_sku_evidence_too_many');
     line={partnerId,shopSku:item.shopSku,
      name:String(price?.name||item.offerName||'').slice(0,200),
      deliveredUnits:0,returnedUnits:0,
      costKopecks:price?.costKopecks??null,
      costStatus:price?.status||'missing'};
     result.push(line);
    }
    line[type==='delivered'?'deliveredUnits':'returnedUnits']=item.units;
    if(!line.name&&item.offerName)line.name=item.offerName;
   }
  }
 }
 const missing=result.filter(x=>x.deliveredUnits>0&&
  x.costKopecks===null);
 return {month:costAudit.month,rows:result,issues,
  missing:missing.map(x=>({partnerId:x.partnerId,shopSku:x.shopSku,
   name:x.name,deliveredUnits:x.deliveredUnits})),
  sourceKind:'BROWSER_AUDITED_REALIZATION_SKU_SUMMARY',
  netProfitKopecks:null};
}
