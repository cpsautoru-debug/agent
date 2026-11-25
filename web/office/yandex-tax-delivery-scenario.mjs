// Source-only management tax scenario: October-delivered Yandex items
// matched to the same official order-level gross amounts.
// NOT an AУСН cash-method tax base. No personal identifiers leave this helper.
const id=x=>typeof x==='string'&&/^\d{1,20}$/.test(x)?x:null;
const safe=x=>Number.isSafeInteger(x)&&x>=0;
export function yandexDeliveryGrossScenario(month,orders,realizations){
 const a=orders?.sheets?.find(s=>s.sheet==='services_and_orders_margin.json');
 const b=realizations?.sheets?.find(s=>s.sheet==='delivered.json');
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||!a||!b||
   !Array.isArray(a.marginOrderLedger)||!Array.isArray(b.deliveryOrderLedger)||
   a.rows!==a.marginOrderLedger.length||
   b.rows!==b.deliveryOrderLedger.length||
   a.rows<1||b.rows<1||a.rows>2000||b.rows>2000||
   a.duplicateOrderIds!==0||a.ordersWithIds!==a.rows||
   b.realizationSkuCoverage?.recognizedRows!==b.rows||
   b.realizationSkuCoverage?.unmappedRows!==0||
   b.realizationSkuCoverage?.invalidQuantityRows!==0)
  return null;
 const byOrder=new Map();
 for(const row of a.marginOrderLedger){
  const key=id(row.orderId);
  if(!key||byOrder.has(key)||!safe(row.grossKopecks)||
    !Number.isSafeInteger(row.incomeKopecks))
   return null;
  byOrder.set(key,row);
 }
 let sum=0n,units=0;
 const selected=new Set();
 for(const row of b.deliveryOrderLedger){
  const key=id(row.orderId);
  if(!key||!byOrder.has(key)||typeof row.shopSku!=='string'||
    !row.shopSku||!Number.isSafeInteger(row.units)||row.units<1)
   return null;
  units+=row.units;
  if(row.deliveryDate&&row.deliveryDate.slice(0,7)!==month)return null;
  if(!selected.has(key)){
   selected.add(key);
   sum+=BigInt(byOrder.get(key).grossKopecks);
  }
 }
 if(units!==b.quantityTotals?.deliveredCount?.total||
   sum>BigInt(Number.MAX_SAFE_INTEGER))return null;
 const grossKopecks=Number(sum);
 const taxScenarioKopecks=Number((sum*800n+5000n)/10000n);
 return {grossKopecks,taxScenarioKopecks,deliveredOrders:selected.size,
  deliveredUnits:units,excludedOrderRows:a.rows-selected.size,
  status:'delivered_orders_gross_scenario_before_cash_recognition',
  verifiedTaxBase:false};
}