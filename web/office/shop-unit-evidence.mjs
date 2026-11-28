// Read-only SKU evidence. Never attribute all-shop monetary totals to SAD.
import {monthValid,adaptYandex} from './sales-analytics-core.mjs';
const int=Number.isSafeInteger;
export function sadUnitEvidence(month,d){
 if(!monthValid(month)||d?.evidence?.netProfitKopecks!==null)return null;
 const a=adaptYandex(month,d);
 if(a.status!=='saved_summary'||a.sold===null||a.returned===null||!a.rows.length)return null;
 const raw=d.evidence.skus.filter(x=>x.partnerId===149082506);
 return raw.map(x=>{
  const cost=['matched_exact','matched_owner'].includes(x.costStatus)&&int(x.costKopecks)&&x.costKopecks>0&&x.costKopecks<=100000000?x.costKopecks:null;
  const total=cost!==null&&int(cost*x.deliveredUnits)?cost*x.deliveredUnits:null;
  return {sku:x.shopSku,name:String(x.name||''),sold:x.deliveredUnits,returned:x.returnedUnits,cost,total,payout:null,contribution:null,netProfit:null,approvedBudget:null,review:cost===null?'Уточнить себестоимость':x.returnedUnits>=3&&x.deliveredUnits>0&&x.returnedUnits/x.deliveredUnits>=0.1?'Проверить возвраты':'Нужен доход по SKU'};
 }).sort((a,b)=>b.sold-a.sold||a.sku.localeCompare(b.sku));
}
// Rank only comparable, confirmed contribution within one WB report cohort.
// Unknown values stay outside the ranking. Never rank mixed periods or call it net profit.
export function wbContributionRanking(rows){
 if(!Array.isArray(rows))return [];
 return rows.filter(x=>int(x.contribution)&&int(x.sold)&&x.sold>0).slice().sort((a,b)=>b.contribution-a.contribution||a.sku.localeCompare(b.sku)).map(x=>({...x,signal:x.contribution<0?'Отрицательный вклад: проверить расходы и цену':x.contribution>0?'Положительный вклад: проверить полную прибыль':'Нулевой вклад',netProfit:null,approvedBudget:null}));
}

export function sadQuantityEvidence(month,d){
 if(!monthValid(month)||d?.code!=='sad_sales_sku'||d.month!==month||d.campaignId!==149082506||d.readOnly!==true||d.changedRecords!==0||d.coverageComplete!==true||!Array.isArray(d.rows)||d.rows.length>500)return null;
 const seen=new Set(),rows=[];
 for(const x of d.rows){if(!x||typeof x.sku!=='string'||!x.sku||seen.has(x.sku)||!int(x.sold)||x.sold<0||!int(x.returned)||x.returned<0)return null;seen.add(x.sku);rows.push({sku:x.sku,name:String(x.name||''),sold:x.sold,returned:x.returned,cost:null,total:null,payout:null,contribution:null,netProfit:null,approvedBudget:null,review:'Нужна сверка себестоимости и дохода'});}
 return rows.sort((a,b)=>b.sold-a.sold||a.sku.localeCompare(b.sku));
}

// Historical WB article matches are review evidence, not physical identity
// attestations. No automatic transfer to a confirmed cost ledger.
export function attachSadWbCostReview(month,rows,audit){
 if(!monthValid(month)||!Array.isArray(rows)||audit?.code!=='unified_finance_source_audit'||audit.month!==month||audit.readOnly!==true||audit.changedRecords!==0||audit.wb?.status!=='ready'||!Array.isArray(audit.wb.entries)||audit.wb.entries.length>2000)return rows;
 const [y,m]=month.split('-').map(Number),start=month+'-01',end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
 return rows.map(x=>{
  if(x.cost!==null)return x;
  const overlap=audit.wb.entries.filter(c=>c?.vendorCode===x.sku&&typeof c.validFrom==='string'&&c.validFrom<=end&&(c.validTo===null||typeof c.validTo==='string'&&c.validTo>=start));
  if(overlap.length!==1)return {...x,review:overlap.length?'Конфликт версий WB — проверить':'Нет точной нормы WB за период'};
  const c=overlap[0];
  if(c.status!=='confirmed'||c.validFrom>start||(c.validTo!==null&&c.validTo<end)||!int(c.costKopecks)||c.costKopecks<=0||c.costKopecks>100000000)return {...x,review:'Норма WB не подтверждена на весь период'};
  const estimate=int(c.costKopecks*x.sold)?c.costKopecks*x.sold:null;
  return {...x,candidateCost:c.costKopecks,candidateTotal:estimate,candidateSource:'WB_EXACT_ARTICLE_FULL_MONTH',review:'Точный артикул WB: подтвердить идентичность изделия и вид себестоимости'};
 });
}

export function sadOrderReview(month,jobs,orders,realization){
 if(!monthValid(month)||jobs?.code!=='yandex_report_jobs_saved'||jobs.readOnly!==true||!Array.isArray(jobs.jobs))return null;
 const matches=(scope,type)=>jobs.jobs.filter(x=>x.month===month&&x.scope===scope&&x.reportType===type&&x.status==='DONE');
 if(matches('all','orders').length!==1||matches('149082506','realization').length!==1)return null;
 const verified=x=>x?.code==='yandex_report_archive_audited'&&x.readOnly===true&&x.changedRecords===0&&Array.isArray(x.sheets);
 if(!verified(orders)||!verified(realization))return null;
 const o=orders.sheets.find(x=>x.sheet==='services_and_orders_margin.json'),r=realization.sheets.find(x=>x.sheet==='delivered.json');
 if(!o||!r||!Array.isArray(o.marginOrderLedger)||!Array.isArray(r.deliveryOrderLedger)||o.rows!==o.marginOrderLedger.length||r.rows!==r.deliveryOrderLedger.length||o.rows>2000||r.rows>2000||o.duplicateOrderIds!==0||o.ordersWithIds!==o.rows)return null;
 const id=x=>typeof x==='string'&&/^\d{1,20}$/.test(x);
 const map=new Map(),delivered=new Map();
 for(const x of o.marginOrderLedger){if(!id(x.orderId)||map.has(x.orderId)||!int(x.incomeKopecks))return null;map.set(x.orderId,x.incomeKopecks);}
 for(const x of r.deliveryOrderLedger){if(!id(x.orderId)||typeof x.shopSku!=='string'||!x.shopSku||!int(x.units)||x.units<0)return null;const set=delivered.get(x.orderId)||new Set();set.add(x.shopSku);delivered.set(x.orderId,set);}
 let matched=0,multi=0;for(const [key,skus] of delivered){if(map.has(key))matched++;if(skus.size>1)multi++;}
 // A realization row does not establish full order composition. Never assign
 // order-level income to a SKU simply because it is the sole delivered SKU.
 return {orders:delivered.size,matched,unmatched:delivered.size-matched,multiSku:multi,skuIncomeVerified:false,netProfit:null};
}
