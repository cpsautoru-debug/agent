// Historical Ozon SKU evidence, never a current tariff or profit estimate.
export function ozonUnitEvidence(month,d){
 const r=d?.result,doc=d?.configuration?.month;
 if(d?.target!=='ce9dd331-929d-4c3e-9073-368de3346bc9'||doc?.month!==month||r?.report?.periodVerified!==true||r.report.quantityVerified!==true||!Array.isArray(r.skuRows)||!Array.isArray(doc.rows)||!Array.isArray(r.duplicateCandidates)||r.duplicateCandidates.length)return [];
 const revenue=new Map();
 for(const x of doc.rows){if(x.service!=='Выручка')continue;
 if(typeof x.sku!=='string'||!x.sku||!Number.isSafeInteger(x.quantity)||x.quantity<1||!Number.isSafeInteger(x.amountKopecks)||x.amountKopecks<0)return [];
 const a=revenue.get(x.sku)||{units:0,amount:0};a.units+=x.quantity;a.amount+=x.amountKopecks;if(!Number.isSafeInteger(a.units)||!Number.isSafeInteger(a.amount))return [];revenue.set(x.sku,a);}
 const result=[],seen=new Set();
 for(const x of r.skuRows){if(!x.soldUnits)continue;
 if(typeof x.sku!=='string'||seen.has(x.sku)||!Number.isSafeInteger(x.soldUnits)||x.soldUnits<1)return [];seen.add(x.sku);
 const a=revenue.get(x.sku);if(!a||a.units!==x.soldUnits)return [];
 const cost=x.costStatus==='confirmed'&&Number.isSafeInteger(x.costKopecks)&&x.costKopecks>0?x.costKopecks:null;
 result.push({sku:x.sku,name:String(x.name||''),sold:x.soldUnits,returned:Number.isSafeInteger(x.returnedUnits)&&x.returnedUnits>=0?x.returnedUnits:null,averageRevenueKopecks:Math.round(a.amount/a.units),historicalCostKopecks:cost,costBasis:null,platform:null,logistics:null,advertising:null,approvedBudget:null});
 }
 if(seen.size!==revenue.size)return [];
 return result.sort((a,b)=>b.sold-a.sold||a.sku.localeCompare(b.sku));
}
