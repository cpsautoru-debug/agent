import {createHash} from 'node:crypto';

export const WORKBOOK_ID='11Qb-AR6nlR-Yt89Pu8nviqAud7h6Hrmba4gNEXU47Q4';
/** Zero-based columns, verified from the live workbook on 20.10.2026. Never write these ranges. */
export const SHEET_MAPPING=Object.freeze({
  'Остаток':{sheetId:414775231,headerRow:1,width:7,item:0,unit:1,quantity:5,headers:{0:'Название материала',1:'Ед.',5:'Остаток'},formulaColumns:['C','D','E','F','G'],sources:['assortment','stockByStore'],meaning:'Расчётный остаток материалов'},
  'Приход':{sheetId:0,headerRow:1,width:8,item:2,unit:3,quantity:4,headers:{0:'Дата',2:'Название материала',4:'Кол-во'},formulaColumns:['G'],sources:['supplies','supplies/positions'],meaning:'Приёмка: документ и позиция, не заказ поставщику'},
  'Раскрой':{sheetId:218679490,headerRow:1,width:11,item:1,unit:4,quantity:3,headers:{1:'Продукт кроя',3:'Кол-во'},formulaColumns:['C','G','H'],sources:['processings','productionStageCompletions'],meaning:'Выпуск кроя; расход материалов уже отражён документом производства'},
  'Пошив':{sheetId:32853933,headerRow:1,width:10,item:1,unit:3,quantity:2,headers:{1:'Название чехла',2:'Кол-во'},formulaColumns:['F','G'],sources:['processings','productionStageCompletions'],meaning:'Выпуск готового изделия; не повторять списание из расхода'},
  'Комплектации':{sheetId:802667720,headerRow:1,width:8,item:0,material:2,unit:4,quantity:3,headers:{0:'Название чехла',2:'Название материала / операции',3:'Норма'},formulaColumns:['F','H'],sources:['processingPlans/materials','processingPlans/products'],meaning:'Нормативная спецификация, а не физический остаток'},
  'Техкарты':{sheetId:557129041,headerRow:1,width:8,item:0,material:2,unit:4,quantity:3,headers:{0:'Название продукта/кроя',2:'Название материала / операции',3:'Норма'},formulaColumns:['H'],sources:['processingPlans/materials','processingPlans/products'],meaning:'Нормы материала/операции; оплата труда отдельно от количества'},
  'Инвентаризация кроя 20.10':{sheetId:176201026,headerRow:4,width:6,item:1,quantity:3,partial:4,headers:{3:'Количество в наличии'},headerPrefixes:{1:'Наименование раскроя'},formulaColumns:[],sources:['assortment','stockByStore'],meaning:'Датированный физический пересчёт; единица и склад требуют подтверждения'},
});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sameTime=(a,b)=>typeof a==='string'&&typeof b==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(a)&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(b)&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
export function moyskladId(value){
  if(UUID.test(value?.id||''))return value.id.toLowerCase();
  const match=String(value?.meta?.href||'').match(/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/[a-z]+\/([a-f0-9-]{36})$/i);
  return match&&UUID.test(match[1])?match[1].toLowerCase():null;
}
const normalize=name=>String(name||'').trim().toLocaleLowerCase('ru');
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value??null);
/** Review ledger only. No "processed" flag is committed and no movements are generated. */
export function reviewDocumentIdentities(documents=[],previous=[]){
  const issues=[],seen=new Map(),prior=new Map(),proposedLedger=[];
  for(const entry of previous){if(!entry||typeof entry.key!=='string'||!/^[a-f0-9]{64}$/.test(entry.hash||'')){issues.push({code:'INVALID_LEDGER'});continue;}if(prior.has(entry.key))issues.push({code:'DUPLICATE_LEDGER_KEY',key:entry.key});prior.set(entry.key,entry.hash);}
  for(const doc of documents){
    const type=doc?.meta?.type;
    if(!UUID.test(doc?.accountId||'')||!UUID.test(doc?.id||'')||!['supply','demand','loss','purchaseorder','customerorder','processing','processingorder','productiontask','productionstagecompletion'].includes(type)){issues.push({code:'DOCUMENT_IDENTITY_MISSING'});continue;}
    const key=doc.accountId.toLowerCase()+':'+type+':'+doc.id.toLowerCase(),hash=createHash('sha256').update(canonical(doc)).digest('hex');
    if(seen.has(key)){issues.push({code:seen.get(key)===hash?'DUPLICATE_DOCUMENT':'CONFLICTING_DOCUMENT_VERSION',key});continue;}
    seen.set(key,hash);const state=prior.has(key)?prior.get(key)===hash?'already-reviewed':'changed-needs-review':'new-needs-review';
    if(state==='changed-needs-review')issues.push({code:'DOCUMENT_CHANGED',key});
    if(doc.applied!==true)issues.push({code:'DOCUMENT_NOT_APPLIED',key});
    proposedLedger.push({key,hash,state,updated:doc.updated||null,applied:doc.applied===true});
  }
  return {issues,proposedLedger,writeOperations:[]};
}
/** Inputs are private runtime exports. Names suggest candidates only; explicit approved bindings are mandatory. */
export function buildMoyskladDiscrepancyReport({sheetSnapshot,catalogSnapshot,stockSnapshot,bindings=[],documents=[],ledger=[]}){
  const issues=[],comparisons=[],mappingReview=[];
  const result={readOnly:true,writeOperations:[],issues,comparisons,mappingReview};
  if(sheetSnapshot?.spreadsheetId!==WORKBOOK_ID){issues.push({code:'WRONG_WORKBOOK'});return result;}
  if(catalogSnapshot?.complete!==true||stockSnapshot?.complete!==true||!Array.isArray(catalogSnapshot.rows)||!Array.isArray(stockSnapshot.rows)){issues.push({code:'INCOMPLETE_SOURCE'});return result;}
  const sheets=new Map(),catalog=new Map(),stocks=new Map();
  for(const sheet of sheetSnapshot.sheets||[]){if(sheets.has(sheet.title)){issues.push({code:'DUPLICATE_SHEET',sheet:sheet.title});return result;}sheets.set(sheet.title,sheet);}
  for(const item of catalogSnapshot.rows){const id=moyskladId(item);if(!id)continue;const values=catalog.get(id)||[];values.push(item);catalog.set(id,values);}
  for(const item of stockSnapshot.rows){const id=moyskladId(item);if(!id)continue;for(const stock of item.stockByStore||[]){const store=moyskladId(stock);if(!store)continue;const key=id+':'+store,list=stocks.get(key)||[];list.push(stock);stocks.set(key,list);}}
  const approved=new Map(),targetRows=new Set(),remoteTargets=new Set();
  for(const b of bindings){
    if(!b||!Object.hasOwn(SHEET_MAPPING,b.sheet)||!Number.isSafeInteger(b.row)||b.row<=SHEET_MAPPING[b.sheet].headerRow){issues.push({code:'INVALID_BINDING'});continue;}
    const key=b.sheet+':'+b.row;
    if(approved.has(key)){approved.set(key,null);issues.push({code:'DUPLICATE_ROW_BINDING',sheet:b.sheet,row:b.row});}else approved.set(key,b);
  }
  for(const [title,schema] of Object.entries(SHEET_MAPPING)){
    const sheet=sheets.get(title),rows=sheet?.rows;
    if(!Array.isArray(rows)){issues.push({code:'MISSING_SHEET',sheet:title});continue;}
    if(rows.length>5000){issues.push({code:'SHEET_TOO_LARGE',sheet:title});continue;}
    const header=rows[schema.headerRow-1];
    if(!header||Object.entries(schema.headers).some(([column,name])=>header[Number(column)]!==name)||Object.entries(schema.headerPrefixes||{}).some(([column,prefix])=>typeof header[Number(column)]!=='string'||!header[Number(column)].startsWith(prefix))){issues.push({code:'SHEET_SCHEMA_CHANGED',sheet:title});continue;}
    for(let index=schema.headerRow;index<rows.length;index++){
      const row=rows[index],itemName=row?.[schema.item];if(itemName===''||itemName==null)continue;
      const key=title+':'+(index+1),b=approved.get(key);
      if(!b){
        const candidates=catalogSnapshot.rows.filter(item=>normalize(item.name)===normalize(itemName)).map(moyskladId).filter(Boolean);
        issues.push({code:'MAPPING_REQUIRED',sheet:title,row:index+1,candidateIds:[...new Set(candidates)]});continue;
      }
      targetRows.add(key);
      if(b.approved!==true||b.sheetItem!==itemName||!UUID.test(b.assortmentId||'')){issues.push({code:'UNAPPROVED_OR_STALE_BINDING',sheet:title,row:b.row});continue;}
      const matches=catalog.get(b.assortmentId.toLowerCase())||[];
      if(matches.length!==1){issues.push({code:'CATALOG_ID_NOT_UNIQUE',sheet:title,row:b.row});continue;}
      if(!['Остаток','Инвентаризация кроя 20.10'].includes(title)){
        mappingReview.push({sheet:title,row:b.row,assortmentId:b.assortmentId,status:'requires-document-or-specification-link',sources:schema.sources});continue;
      }
      if(!UUID.test(b.storeId||'')||!UUID.test(b.uomId||'')||moyskladId(matches[0].uom)!==b.uomId.toLowerCase()||typeof b.sheetUnit!=='string'||!b.sheetUnit||(schema.unit!==undefined&&row[schema.unit]!==b.sheetUnit)){
        issues.push({code:'STORE_OR_UNIT_MAPPING_REQUIRED',sheet:title,row:b.row});continue;
      }
      if(!sameTime(sheet.asOf||sheetSnapshot.asOf,stockSnapshot.asOf)||!sameTime(b.asOf,stockSnapshot.asOf)){issues.push({code:'SNAPSHOT_TIME_MISMATCH',sheet:title,row:b.row});continue;}
      if(schema.partial!==undefined&&row[schema.partial]!==''&&row[schema.partial]!=null){issues.push({code:'PARTIAL_PIECES_REQUIRE_REVIEW',sheet:title,row:b.row});continue;}
      const stockKey=b.assortmentId.toLowerCase()+':'+b.storeId.toLowerCase(),remote=stocks.get(stockKey)||[];
      if(remote.length!==1){issues.push({code:'STOCK_MISSING_OR_DUPLICATE',sheet:title,row:b.row});continue;}
      const remoteScope=title+':'+stockKey;
      if(remoteTargets.has(remoteScope)){issues.push({code:'SHARED_STOCK_MAPPING',sheet:title,row:b.row});continue;}remoteTargets.add(remoteScope);
      if(!finite(row[schema.quantity])||!finite(remote[0].stock)){issues.push({code:'NON_NUMERIC_QUANTITY',sheet:title,row:b.row});continue;}
      const delta=remote[0].stock-row[schema.quantity];
      comparisons.push({sheet:title,row:b.row,assortmentId:b.assortmentId,storeId:b.storeId,uomId:b.uomId,asOf:b.asOf,sheetQuantity:row[schema.quantity],moyskladStock:remote[0].stock,delta});
      if(Math.abs(delta)>1e-9)issues.push({code:'STOCK_DIFFERENCE',sheet:title,row:b.row,delta});
    }
  }
  for(const [key,b] of approved)if(b&&!targetRows.has(key))issues.push({code:'BINDING_ROW_NOT_FOUND',sheet:b.sheet,row:b.row});
  result.documentReview=reviewDocumentIdentities(documents,ledger);
  issues.push(...result.documentReview.issues);
  result.status=issues.length||mappingReview.length?'requires-review':comparisons.length?'matched':'no-comparisons';
  return result;
}
