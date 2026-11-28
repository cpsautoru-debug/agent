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
