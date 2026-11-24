// Owner-only shared expense reader from Ozon Profit's versioned D1 cost
// document. Marketplace platform costs remain in each channel, not here.
// Expenses are business-wide and must be subtracted ONCE in the P&L.
export function readOctoberBusinessOverhead(month,audit){
 if(month!=='2026-10'||audit?.code!=='unified_finance_source_audit'||
  audit.readOnly!==true||audit.month!==month||
  audit.expenses?.status!=='ready'||
  !Number.isSafeInteger(audit.expenses?.version)||
  !Array.isArray(audit.expenses?.items)||
  audit.expenses.items.length>500)return null;
 const items=audit.expenses.items.filter(x=>x?.scope==='business'&&
  typeof x.validFrom==='string'&&x.validFrom<=month+'-31'&&
  (x.validTo===null||x.validTo>=month+'-01'));
 if(!items.length)return null;
 const ids=new Set(),result=[];
 for(const x of items){
  if(typeof x.id!=='string'||!x.id||ids.has(x.id)||
     typeof x.label!=='string'||!x.label.trim()||
     !Number.isSafeInteger(x.amountKopecks)||x.amountKopecks<0)
   return null;
  ids.add(x.id);
  result.push({id:'ledger-'+x.id,label:x.label,
   amountKopecks:x.amountKopecks});
 }
 // Verify the source ledger expressly excludes material delivery in Ozon
 // unit manufacturing cost before assuming one-time shared freight costs
 // can be deducted without duplication across channels. WB is separate.
 const ozonEntries=audit.ozonProfit?.entries;
 const freightUncertain=!Array.isArray(ozonEntries)||
  ozonEntries.some(x=>x.leatherDeliveryIncluded!==false);
 return {items:result,status:'ledger_provisional',
  version:audit.expenses.version,
  source:'OZON_PROFIT_VERSIONED_EXPENSES_D1',
  freightOverlapPossible:freightUncertain};
}
