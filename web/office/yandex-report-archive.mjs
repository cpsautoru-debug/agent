import {resolveYandexShop,yandexShopIdentityEvidence} from './yandex-shop-identity.mjs';
// Bounded ZIP/JSON decoder for official Yandex report archives.
// Central-directory parsing supports data descriptors. No external dependencies.
const MAX_ARCHIVE=12*1024*1024;
const MAX_UNCOMPRESSED=24*1024*1024;
function fail(reason){throw Error(reason);}
function crc32(bytes){
 let c=-1;
 for(const b of bytes){
  c^=b;
  for(let j=0;j<8;j++)c=(c>>>1)^(-(c&1)&0xedb88320);
 }
 return (c^(-1))>>>0;
}
export async function parseYandexZip(buffer){
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength>MAX_ARCHIVE||
   buffer.byteLength<22)fail('yandex_zip_size_invalid');
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);
 const u16=n=>view.getUint16(n,true),u32=n=>view.getUint32(n,true);
 let eocd=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){
  if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){eocd=p;break;}
 }
 if(eocd<0)fail('yandex_zip_footer_missing');
 if(u16(eocd+4)!==0||u16(eocd+6)!==0||u16(eocd+8)!==u16(eocd+10))
  fail('yandex_zip_multidisk_forbidden');
 const count=u16(eocd+10),directorySize=u32(eocd+12);
 let pos=u32(eocd+16),total=0;
 if(count<1||count>30||pos+directorySize>eocd)
  fail('yandex_zip_directory_invalid');
 const files={};
 for(let i=0;i<count;i++){
  if(pos+46>eocd||u32(pos)!==0x02014b50)
   fail('yandex_zip_central_invalid');
  const flags=u16(pos+8),method=u16(pos+10),checksum=u32(pos+16);
  const compressed=u32(pos+20),uncompressed=u32(pos+24);
  const nameLength=u16(pos+28),extra=u16(pos+30),comment=u16(pos+32);
  const local=u32(pos+42);
  if(flags&1||![0,8].includes(method)||compressed===0xffffffff||
    uncompressed===0xffffffff||compressed>MAX_ARCHIVE||
    uncompressed>MAX_UNCOMPRESSED)fail('yandex_zip_entry_unsupported');
  if(pos+46+nameLength+extra+comment>eocd)
   fail('yandex_zip_name_invalid');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(
   bytes.subarray(pos+46,pos+46+nameLength));
  pos+=46+nameLength+extra+comment;
  if(name.endsWith('/'))continue;
  if(!/^[a-zA-Z0-9_.-]{1,120}\.json$/.test(name)||files[name])
   fail('yandex_zip_unexpected_file');
  if(local+30>buffer.byteLength||u32(local)!==0x04034b50)
   fail('yandex_zip_local_invalid');
  const dataStart=local+30+u16(local+26)+u16(local+28);
  if(dataStart+compressed>buffer.byteLength)
   fail('yandex_zip_data_truncated');
  total+=uncompressed;
  if(total>MAX_UNCOMPRESSED)fail('yandex_zip_decompressed_limit');
  const part=bytes.slice(dataStart,dataStart+compressed);
  let expanded;
  if(method===0)expanded=part;
  else{
   const stream=new Blob([part]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'));
   const reader=stream.getReader(),chunks=[];let length=0;
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    length+=value.length;
    if(length>uncompressed||length>MAX_UNCOMPRESSED){
     await reader.cancel();fail('yandex_zip_decompressed_limit');
    }
    chunks.push(value);
   }
   expanded=new Uint8Array(length);
   let offset=0;
   for(const chunk of chunks){expanded.set(chunk,offset);offset+=chunk.length;}
  }
  if(expanded.byteLength!==uncompressed||
    crc32(expanded)!==checksum)fail('yandex_zip_checksum_mismatch');
  let content;
  try{content=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(expanded));}
  catch{fail('yandex_report_json_invalid');}
  files[name]=content;
 }
 if(!Object.keys(files).length)fail('yandex_zip_empty');
 return files;
}
export function describeYandexReportSheets(files){
 if(!files||typeof files!=='object')fail('yandex_report_missing');
 const sheets=[];
 for(const [name,content] of Object.entries(files)){
  const rows=Array.isArray(content)?content:
   Array.isArray(content?.rows)?content.rows:
   Array.isArray(content?.data)?content.data:null;
  if(rows===null||rows.length>100000)
   fail('yandex_report_sheet_structure_unknown');
  const names=Object.keys(rows[0]||{}).slice(0,100);
  const sumFields=Object.fromEntries(['transactionSum','servicePrice',
   'buyerPaymentAmount','billingPrice',
   'incomeWithoutServices','summaryCommission','sumBillingPriceOfItems',
   'marketplaceDiscountPaymentAmount','refundBuyerPaymentAmount'].map(field=>{
   let count=0,sumKopecks=0,invalid=0;
   for(const row of rows){
    const value=row?.[field];
    if(value===undefined||value===null||value==='')continue;
    if(typeof value!=='number'||!Number.isFinite(value)||
      !Number.isSafeInteger(Math.round(value*100))){
     invalid++;continue;
    }
    count++;
    sumKopecks+=Math.round(value*100);
   }
   return [field,{present:count,invalid,
    totalKopecks:Number.isSafeInteger(sumKopecks)?sumKopecks:null}];
  }));
  const types={};
  if(/transaction_date\.json$/i.test(name)){
   for(const row of rows){
    const type=String(row.transactionType||'UNKNOWN').slice(0,120);
    const price=row.transactionSum;
    if(typeof price!=='number'||!Number.isFinite(price))continue;
    const next=(types[type]||0)+Math.round(price*100);
    if(!Number.isSafeInteger(next))fail('yandex_amount_overflow');
    types[type]=next;
   }
  }
  const amountFields=['buyerPaid','servicePrice','fullPrice',
   'paymentAmount','transactionSum','buyerPaymentAmount',
   'merchantPrice','sellPrice','billingPrice'];
  const toKopecks=v=>{
   if(typeof v!=='number'||!Number.isFinite(v))return null;
   const k=Math.round(v*100);
   return Number.isSafeInteger(k)?k:null;
  };
  // Only fixed, low-cardinality business dimensions. Never publish raw
  // order/customer details, arbitrary user-provided fields, or raw SKU lists.
  const allowedServiceTypes=['serviceName','service','recordType',
    'transactionType','model','placementModel','orderStatus'];
  const dimensions={};
  for(const dimension of allowedServiceTypes){
   const grouped=new Map(),fieldStats={};
   let observed=0,excluded=0;
   for(const row of rows){
    const v=row?.[dimension];
    if(typeof v!=='string'||!v||v.length>120)continue;
    observed++;
    if(!grouped.has(v)&&grouped.size>=40){excluded++;continue;}
    const agg=grouped.get(v)||{rows:0,amounts:{}};
    agg.rows++;
    for(const field of amountFields){
     const k=toKopecks(row?.[field]);
     if(k===null)continue;
     const next=(agg.amounts[field]||0)+k;
     if(!Number.isSafeInteger(next))fail('yandex_amount_overflow');
     agg.amounts[field]=next;
    }
    grouped.set(v,agg);
   }
   if(observed)
    dimensions[dimension]={groups:[...grouped.entries()].map(
      ([value,v])=>({value,rows:v.rows,amounts:v.amounts})),
      observed,excluded,
      note:'A column is summed only within its source report. Cross-field totals are NOT profit.'};
  }
  const shops=new Map();
  for(const row of rows){
   const shop=resolveYandexShop(row);
   if(shop===null)continue;
   const agg=shops.get(shop)||{rows:0,amounts:{}};
   agg.rows++;
   for(const field of amountFields){
    const k=toKopecks(row?.[field]);
    if(k===null)continue;
    const next=(agg.amounts[field]||0)+k;
    if(!Number.isSafeInteger(next))fail('yandex_amount_overflow');
    agg.amounts[field]=next;
   }
   shops.set(shop,agg);
  }
  // SKU inventory enables exact owner-approved cost matching later.
  // Order report transaction rows are not necessarily sold units: NEVER
  // equate count of rows or deliveredOrReturned with finalized sales.
  const skuMap=new Map();
  for(const row of rows){
   const code=row?.shopSku;
   const shop=resolveYandexShop(row);
   if(typeof code!=='string'||!code||code.length>120||
     shop===null)continue;
   const key=shop+':'+code;
   if(!skuMap.has(key)&&skuMap.size>=250)continue;
   const existing=skuMap.get(key)||{partnerId:shop,shopSku:code,
    offerName:typeof row.offerName==='string'?
      row.offerName.slice(0,160):'',
    reportRows:0,statuses:[]};
   existing.reportRows++;
   const status=row.offerStatus||row.orderStatus;
   if(typeof status==='string'&&status.length<=60&&
      !existing.statuses.includes(status)&&existing.statuses.length<8)
     existing.statuses.push(status);
   skuMap.set(key,existing);
  }
  // The orders-and-services margin sheet is order-level. Its canonical
  // net-after-order-services field must not be reduced by the same
  // summaryCommission a second time. Do not call this business net profit.
  const marginSheet=/^services_and_orders_margin\\.json$/i.test(name);
  const orderKeys=new Set();let duplicateOrderIds=0,ordersWithIds=0;
  if(marginSheet){
   for(const row of rows){
    if(row?.orderId==null)continue;
    const id=String(row.orderId);
    if(!/^\\d{1,20}$/.test(id))continue;
    ordersWithIds++;
    if(orderKeys.has(id))duplicateOrderIds++;
    else orderKeys.add(id);
   }
  }
  sheets.push({sheet:name,rows:rows.length,fields:names,
   isOrderMarginSource:marginSheet,ordersWithIds,duplicateOrderIds,
   sumFields,transactionTypes:types,dimensions,
   shops:[...shops.entries()].map(([partnerId,v])=>({partnerId,...v})),
   recognizedShopRows:[...shops.values()].reduce((sum,v)=>sum+v.rows,0),
   shopIdentityEvidence:yandexShopIdentityEvidence(rows),
   groupingStatus:shops.size?'verified_campaign_or_shop_name':
     'shop_attribution_unavailable',
   skuCandidates:[...skuMap.values()],
   skuSourceCoverage:skuMap.size,
   skuCompleteness:'SKU identification only; unit sales and COGS not verified'});
 }
 return {sheets,
  note:'Amounts are raw source-field totals, NOT accounting revenue or net profit. Cross-sheet totals must not be added.'};
}
