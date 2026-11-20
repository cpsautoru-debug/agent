// Pure WB Finance normalization; all money is exact integer kopecks.
// Never infer missing COGS or silently replace an unknown vendor price with zero.
const ID=/^\d{1,20}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export const FINANCE_FIELDS=[
  'reportId','rrdId','sellerOperName','vendorCode','currency','quantity',
  'forPay','deliveryService','paidStorage','deduction','penalty',
  'additionalPayment','paidAcceptance'
];
export function moneyKop(value,optional=false){
  if(optional && (value==null||value===''))return 0;
  const s=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof s!=='string'||!/^-?\d+(?:\.\d{1,2})?$/.test(s))throw Error('invalid_money');
  const negative=s.startsWith('-');
  const [w,f='']=(negative?s.slice(1):s).split('.');
  const cents=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));
  if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw Error('money_overflow');
  return Number(negative?-cents:cents);
}
export function exactFinanceJson(text){
  return JSON.parse(text.replace(/("(?:reportId|rrdId)"\s*:\s*)(\d+)/g,'$1"$2"'));
}
export function parseId(raw){
  const id=typeof raw==='string'?raw:Number.isSafeInteger(raw)?String(raw):'';
  if(!ID.test(id))throw Error('invalid_identifier');
  return id;
}
export function normalizeReport(row){
  const reportId=parseId(row?.reportId);
  if(!DATE.test(row.dateFrom||'')||!DATE.test(row.dateTo||'')||
    row.dateFrom>row.dateTo||![1,2].includes(row.reportType)||
    (row.currency!=null&&row.currency!=='RUB'))throw Error('invalid_report_metadata');
  return {reportId,dateFrom:row.dateFrom,dateTo:row.dateTo,
    reportType:row.reportType,bankPaymentKop:moneyKop(row.bankPaymentSum)};
}
export function normalizeOperation(row,reportId){
  if(parseId(row?.reportId)!==reportId||row.currency!=='RUB'||
    typeof row.sellerOperName!=='string'||!row.sellerOperName)throw Error('invalid_operation');
  const rrdId=parseId(row.rrdId),sale=['Продажа','Возврат'].includes(row.sellerOperName);
  const quantity=Number(row.quantity??0);
  if(!Number.isSafeInteger(quantity)||quantity<0||quantity>10000)throw Error('invalid_quantity');
  const vendorCode=row.vendorCode==null?null:String(row.vendorCode);
  if(vendorCode!=null&&(!vendorCode.trim()||vendorCode.length>200))throw Error('invalid_vendor_code');
  if(sale&&(!vendorCode||quantity===0))throw Error('sale_missing_product');
  return {
    rrdId,sellerOperName:row.sellerOperName,vendorCode,quantity,
    forPayKop:moneyKop(row.forPay,!sale),
    deliveryServiceKop:moneyKop(row.deliveryService,true),
    paidStorageKop:moneyKop(row.paidStorage,true),
    deductionKop:moneyKop(row.deduction,true),
    penaltyKop:moneyKop(row.penalty,true),
    additionalPaymentKop:moneyKop(row.additionalPayment,true),
    paidAcceptanceKop:moneyKop(row.paidAcceptance,true)
  };
}
export function payoutFromRows(rows){
  let total=0;
  for(const x of rows){
    if(x.sellerOperName==='Продажа')total+=x.forPayKop;
    if(x.sellerOperName==='Возврат')total-=x.forPayKop;
    total-=x.deliveryServiceKop+x.paidStorageKop+x.deductionKop+x.penaltyKop;
  }
  if(!Number.isSafeInteger(total))throw Error('money_overflow');
  return total;
}
