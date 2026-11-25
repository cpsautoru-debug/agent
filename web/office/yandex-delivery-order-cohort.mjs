// Match October delivery-realization items to the SAME order-level
// incomeWithoutServices rows. This is a management cohort, NOT tax profit.
// Order IDs stay in the protected source audit and are not returned here.
const safe=x=>Number.isSafeInteger(x);
const id=x=>typeof x==='string'&&/^\d{1,20}$/.test(x)?x:null;
const unavailable=reason=>({status:'unavailable',reason,
 deliveredOrders:null,deliveredUnits:null,
 orderAfterServicesKopecks:null,manufacturingCostKopecks:null,
 preliminaryContributionKopecks:null,
 excludedOtherOrderRows:null,verifiedNetProfit:false});
export function reconcileYandexDeliveryOrderCohort(month,sources,realizations,skuRows){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))
  return unavailable('invalid_month');
 const orders=sources?.orders?.sheets?.find(x=>
  x.sheet==='services_and_orders_margin.json');
 const delivered=realizations?.[149082506]?.sheets?.find(x=>
  x.sheet==='delivered.json');
 if(!orders||!delivered||!Array.isArray(skuRows))
  return unavailable('source_missing');
 const margin=orders.marginOrderLedger,ship=delivered.deliveryOrderLedger;
 if(!Array.isArray(margin)||!Array.isArray(ship)||!margin.length||
   !ship.length||margin.length!==orders.rows||
   ship.length!==delivered.rows||orders.duplicateOrderIds!==0||
   orders.ordersWithIds!==orders.rows)
  return unavailable('order_cohort_coverage_incomplete');
 const orderById=new Map();
 for(const item of margin){
  const key=id(item.orderId);
  if(!key||orderById.has(key)||!safe(item.incomeKopecks)||
    !safe(item.grossKopecks))
   return unavailable('order_cohort_amount_invalid');
  orderById.set(key,item);
 }
 const costBySku=new Map();
 for(const item of skuRows){
  if(Number(item.partnerId)!==149082506)continue;
  if(typeof item.shopSku!=='string'||!item.shopSku||
    costBySku.has(item.shopSku)||!safe(item.costKopecks)||
    item.costKopecks<=0||!['matched_exact','matched_owner']
     .includes(item.status))return unavailable('sku_unit_cost_not_verified');
  costBySku.set(item.shopSku,item.costKopecks);
 }
 const seenOrders=new Set();let deliveredUnits=0,cogs=0,
  afterServices=0,orderGross=0;
 const rowSkuTotals=new Map();
 for(const item of ship){
  const key=id(item.orderId),sku=item.shopSku,qty=item.units;
  if(!key||typeof sku!=='string'||!sku||
     !safe(qty)||qty<1||!orderById.has(key)||
     !costBySku.has(sku))
   return unavailable('delivered_item_not_matched');
  if(item.deliveryDate&&typeof item.deliveryDate==='string'&&
    /^20\d{2}-\d{2}-\d{2}$/.test(item.deliveryDate)&&
    item.deliveryDate.slice(0,7)!==month)
   return unavailable('delivered_date_outside_month');
  const amount=qty*costBySku.get(sku);
  if(!safe(amount)||!safe(cogs+amount)||!safe(deliveredUnits+qty))
   return unavailable('delivery_cost_overflow');
  cogs+=amount;deliveredUnits+=qty;
  rowSkuTotals.set(sku,(rowSkuTotals.get(sku)||0)+qty);
  if(!seenOrders.has(key)){
   seenOrders.add(key);
   const x=orderById.get(key);
   if(!safe(afterServices+x.incomeKopecks)||!safe(orderGross+x.grossKopecks))
    return unavailable('cohort_income_overflow');
   afterServices+=x.incomeKopecks;
   orderGross+=x.grossKopecks;
  }
 }
 const totalSkuCount=skuRows.filter(x=>Number(x.partnerId)===149082506)
  .filter(x=>safe(x.deliveredUnits)&&x.deliveredUnits>0)
  .reduce((n,x)=>n+x.deliveredUnits,0);
 if(totalSkuCount!==deliveredUnits||
  delivered.quantityTotals?.deliveredCount?.total!==deliveredUnits||
  !safe(afterServices-cogs))
  return unavailable('delivery_sku_unit_totals_mismatch');
 return {
  status:'matched_delivery_cohort_before_other_expenses',
  deliveredOrders:seenOrders.size,deliveredUnits,
  orderAfterServicesKopecks:afterServices,
  orderGrossKopecks:orderGross,
  manufacturingCostKopecks:cogs,
  preliminaryContributionKopecks:afterServices-cogs,
  excludedOtherOrderRows:margin.length-seenOrders.size,
  period:month,verifiedNetProfit:false,
  caveats:['marketplace_discount_compensation_not_bank_reconciled',
   'return_payments_outside_delivered_cohort',
   'other_month_service_charges','outside_marketplace_ads',
   'single_ip_ausn_tax']
 };
}