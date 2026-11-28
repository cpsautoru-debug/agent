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
 const out=empty('Яндекс Маркет','Доход по заказам после учтённых услуг');
 if(d?.code!=='yandex_month_evidence_available'||d.month!==month||d.readOnly!==true||d.sourceKind!=='owner_browser_audited_summary'||d.evidence?.ownerEntity!=='ИП Жилина Ольга')return out;
 const e=d.evidence;
 // Existing snapshot covers two campaign IDs; do not represent it as a single shop.
 out.meaning+=' (оба магазина в сохранённом отчёте)';
 if(integer(e.orderAfterServiceKopecks)){out.amount=e.orderAfterServiceKopecks;out.status='saved_summary';}
 // SKU data needs independent shop identity/coverage verification before being displayed.
 return out;
}
export function compareAmounts(a,b){if(a.channel!==b.channel||a.meaning!==b.meaning||a.status!==b.status||!integer(a.amount)||!integer(b.amount)||!integer(a.amount-b.amount))return null;const delta=a.amount-b.amount;const bps=b.amount>0?Math.round(delta/b.amount*10000):null;return {delta,bps:integer(bps)?bps:null};}
