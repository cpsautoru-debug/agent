// Read-only analytics: preserve source definitions, never sum incompatible money.
export const monthValid=m=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(m||'');
export function previousClosedMonth(m){if(!monthValid(m))throw Error('invalid_month');const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);}
const integer=Number.isSafeInteger;
const count=n=>integer(n)&&n>=0;
const sum=a=>{let n=0;for(const x of a){if(!count(x)||!integer(n+x))return null;n+=x;}return n;};
const empty=(channel,meaning)=>({channel,meaning,amount:null,sold:null,returned:null,rows:[],status:'unavailable'});
export function adaptOzon(month,d){
 const out=empty('Ozon','Выручка по XLSX до возвратов');
 const r=d?.result?.report;
 if(d?.target!=='ce9dd331-929d-4c3e-9073-368de3346bc9'||d?.configuration?.month?.month!==month||r?.periodVerified!==true||!integer(r.salesKopecks))return out;
 out.amount=r.salesKopecks;out.status='source_report';
 if(r.quantityVerified===true&&Array.isArray(d.result.skuRows)){
  const rows=d.result.skuRows.filter(x=>count(x.soldUnits)&&count(x.returnedUnits));
  if(rows.length===d.result.skuRows.length&&rows.length>0){out.rows=rows.map(x=>({sku:String(x.sku),name:x.name||'',sold:x.soldUnits,returned:x.returnedUnits}));out.sold=sum(rows.map(x=>x.soldUnits));out.returned=sum(rows.map(x=>x.returnedUnits));}
 }
 return out;
}
export function adaptWb(month,d){
 const out=empty('Wildberries','К перечислению за продажи до возвратов и отдельных удержаний');
 if(d?.code!=='wb_month_settlement'||d.month!==month||d.readOnly!==true||d.changedRecords!==0||d.source!=='WB_FINANCE_API_D1'||d.reportPeriodCovered!==true||d.settlementReconciled!==true||!integer(d.productPayoutKopecks))return out;
 out.amount=d.productPayoutKopecks;out.status='source_report';return out;
}
export function adaptYandex(month,d){
 const out=empty('Яндекс Маркет · Сад','Доход после услуг (только Сад)');
 if(d?.code!=='yandex_month_evidence_available'||d.month!==month||d.readOnly!==true||d.sourceKind!=='owner_browser_audited_summary'||d.evidence?.ownerEntity!=='ИП Жилина Ольга')return out;
 const e=d.evidence;
 // All-shop monetary evidence is deliberately excluded from SAD analytics.
 if(month<'2026-10'||!Array.isArray(e.skus)||!Array.isArray(e.issues)||e.issues.some(x=>x.partnerId===149082506)||!e.skus.some(x=>x.partnerId===149082506))return out;
 const rows=e.skus.filter(x=>x.partnerId===149082506);
 if(rows.some(x=>typeof x.shopSku!=='string'||!x.shopSku||!count(x.deliveredUnits)||!count(x.returnedUnits))||new Set(rows.map(x=>x.shopSku)).size!==rows.length)return out;
 out.rows=rows.map(x=>({sku:x.shopSku,name:x.name||'',sold:x.deliveredUnits,returned:x.returnedUnits}));
 out.sold=sum(rows.map(x=>x.deliveredUnits));out.returned=sum(rows.map(x=>x.returnedUnits));out.status='saved_summary';return out;
}
export function attachWbSku(month,out,d){
 if(d?.code!=='wb_sales_sku'||d.month!==month||d.readOnly!==true||d.changedRecords!==0||d.coverageComplete!==true||!Array.isArray(d.rows)||d.rows.length>500)return out;
 const rows=d.rows;if(rows.some(x=>typeof x.sku!=='string'||!x.sku||!count(x.sold)||!count(x.returned))||new Set(rows.map(x=>x.sku)).size!==rows.length)return out;
 return {...out,rows:rows.map(x=>({sku:x.sku,name:'',sold:x.sold,returned:x.returned})),sold:sum(rows.map(x=>x.sold)),returned:sum(rows.map(x=>x.returned))};
}
export function rankSalesRows(rows){return [...rows].filter(x=>count(x.sold)).sort((a,b)=>b.sold-a.sold||String(a.sku).localeCompare(String(b.sku),'ru'));}
export function compareAmounts(a,b){if(a.channel!==b.channel||a.meaning!==b.meaning||a.status!==b.status||!integer(a.amount)||!integer(b.amount)||!integer(a.amount-b.amount))return null;const delta=a.amount-b.amount;const bps=b.amount>0?Math.round(delta/b.amount*10000):null;return {delta,bps:integer(bps)?bps:null};}
