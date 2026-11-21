// Shared-expense allocation boundary for WB + Ozon + other sales channels.
// This library is NOT an automated tax calculator. Explicit provenance and
// allocation ratios must be confirmed before expense figures are reported.
const CHANNELS=['wb','ozon','yandex','avito','offline'];
const CATEGORIES=[
  'packer_payroll','driver_payroll','manager_payroll','quality_control_payroll',
  'rent','utilities','garbage_collection','telecom','business_software',
  'shared_logistics','other_overhead'
];
const safe=Number.isSafeInteger;
const validText=(x,max=200)=>typeof x==='string'&&x.length>0&&
  x.length<=max&&!/[\u0000-\u001f\u007f]/u.test(x);
function allocateExactly(total,shares){
  const items=CHANNELS.map((key,index)=>{
    const numerator=BigInt(total)*BigInt(shares[key]);
    return {key,index,base:Number(numerator/10000n),
      remainder:Number(numerator%10000n)};
  });
  let assigned=items.reduce((sum,x)=>sum+x.base,0);
  const ordered=[...items].sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
  for(let i=0;i<total-assigned;i++)ordered[i].base++;
  const result=Object.fromEntries(items.map(x=>[x.key,x.base]));
  if(Object.values(result).reduce((a,b)=>a+b,0)!==total)
    throw Error('expense_allocation_unbalanced');
  return result;
}
export function allocateBusinessOverheads({month,expenses,allocation}){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!Array.isArray(expenses)||
    expenses.length>500||!allocation||allocation.method!=='confirmed_shares'||
    !validText(allocation.source,250)||
    !CHANNELS.every(x=>safe(allocation.shares?.[x])&&
      allocation.shares[x]>=0&&allocation.shares[x]<=10000)||
    CHANNELS.reduce((n,x)=>n+allocation.shares[x],0)!==10000)
    throw Error('shared_expense_allocation_unverified');
  const seen=new Set(),totals=Object.fromEntries(CHANNELS.map(x=>[x,0]));
  let all=0;
  for(const e of expenses){
    if(!validText(e?.id,100)||seen.has(e.id)||e.month!==month||
      !CATEGORIES.includes(e.category)||!safe(e.amountKopecks)||
      e.amountKopecks<0||e.amountKopecks>1e11||
      !validText(e.source,250)||
      e.includedInManufacturingCogs!==false)
      throw Error('shared_expense_item_unverified');
    seen.add(e.id);
    all+=e.amountKopecks;
    if(!safe(all))throw Error('shared_expense_overflow');
    const parts=allocateExactly(e.amountKopecks,allocation.shares);
    for(const channel of CHANNELS){
      totals[channel]+=parts[channel];
      if(!safe(totals[channel]))throw Error('shared_expense_overflow');
    }
  }
  if(Object.values(totals).reduce((n,x)=>n+x,0)!==all)
    throw Error('shared_expense_unbalanced');
  return {month,totalKopecks:all,channels:totals,
    method:'confirmed_shares',allocationSource:allocation.source,
    status:'confirmed_allocation_not_tax_assessment',
    // COGS, WB ad spend and tax events are excluded by design.
    excludedCategories:['manufacturing_cost','advertising','tax']};
}
export function classifyCostCategory(category){
  if(CATEGORIES.includes(category))return 'shared_overhead';
  if(['materials','seamstress_payroll','cutter_payroll'].includes(category))
    return 'manufacturing_cogs';
  if(category==='advertising')return 'direct_advertising';
  if(category==='tax')return 'entity_tax';
  return 'unverified';
}
