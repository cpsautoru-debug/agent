// Pure calculation boundary: amounts are integer kopecks; no persistence or defaults for business data.
const fail = message => { throw new Error(message); };
const obj = x => x && typeof x === 'object' && !Array.isArray(x) || fail('object required');
const str = (x, empty=false) => typeof x === 'string' && (empty || x.trim()) ? x.trim() : fail('string required');
const bool = x => typeof x === 'boolean' ? x : fail('boolean required');
const int = (x, nonnegative=false) => Number.isSafeInteger(x) && (!nonnegative || x>=0) ? x : fail('safe integer required');
const arr = x => Array.isArray(x) ? x : fail('array required');
const sum = xs => xs.reduce((a,b)=>int(a+b),0);
const mul = (a,b) => int(a*b);
function date(x) {
  if(typeof x!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(Date.parse(x+'T00:00:00Z')) || new Date(x+'T00:00:00Z').toISOString().slice(0,10)!==x) fail('invalid ISO date');
  return x;
}
export function monthBounds(month) {
  if(typeof month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month<'1900-01' || month>'9998-12') fail('invalid month');
  const start=month+'-01', t=new Date(start+'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth()+1);
  return {start,end:t.toISOString().slice(0,10),days:(t-new Date(start+'T00:00:00Z'))/86400000};
}
const inMonth = (d,m) => { date(d); const b=monthBounds(m); if(d<b.start || d>=b.end) fail('date outside month'); return d; };
function range(x) { date(x.validFrom); if(x.validTo!==null) { date(x.validTo); if(x.validTo<x.validFrom) fail('invalid interval'); } }
const active=(x,d)=>x.validFrom<=d && (x.validTo===null || x.validTo>=d);
function channels(x, shares) {
  obj(x); const vals=['ozon','wb','yandex','avito','offline'].map(k=>int(x[k],true));
  const total=sum(vals); if((shares && total!==10000) || (!shares && total<=0)) fail('invalid allocation denominator'); return total;
}
function unique(xs,key) {const seen=new Set();for(const x of xs){const k=x[key];if(seen.has(k)) fail('duplicate '+key);seen.add(k);} }
export function validateProfitDocument(key,value) {
  obj(value); const v=JSON.parse(JSON.stringify(value, (key, x) => { if(typeof x==='number' && !Number.isFinite(x))fail('non-finite number'); return x; }));
  if(key==='costs') {
    arr(v.entries).forEach(x=>{obj(x);str(x.sku);int(x.costKopecks,true);range(x);if(!['confirmed','preliminary'].includes(x.status))fail('invalid cost status');str(x.source,x.status!=='confirmed');if(x.leatherDeliveryIncluded!==null)bool(x.leatherDeliveryIncluded);});
    for(let i=0;i<v.entries.length;i++)for(let j=i+1;j<v.entries.length;j++){const a=v.entries[i],b=v.entries[j];if(a.sku===b.sku && a.validFrom<=(b.validTo||'9999-12-31') && b.validFrom<=(a.validTo||'9999-12-31'))fail('overlapping cost intervals');}
  } else if(key==='expenses') {
    arr(v.items).forEach(x=>{obj(x);str(x.id);str(x.label);int(x.amountKopecks,true);range(x);if(!['business','ozon'].includes(x.scope))fail('invalid scope');bool(x.leatherDelivery);});unique(v.items,'id');
    const a=v.allocation;obj(a);str(a.source,true);if(!['unallocated','shares','revenue'].includes(a.method))fail('invalid allocation');
    if(a.method==='shares'){channels(a.shares,true);str(a.source);}if(a.method==='revenue'){channels(a.revenue,false);str(a.source);}
    if(a.shares!==null)channels(a.shares,true);if(a.revenue!==null)channels(a.revenue,false);
  } else if(key.startsWith('month:')) {
    const month=key.slice(6);monthBounds(month);if(v.month!==month)fail('month mismatch');str(v.sourceName);if(!/^[a-f0-9]{64}$/i.test(v.sourceSha256))fail('invalid SHA256');bool(v.quantityVerified);bool(v.periodVerified);
    arr(v.rows).forEach(x=>{obj(x);int(x.row,true);if(x.row<1)fail('invalid source row');inMonth(x.date,month);str(x.service);str(x.group,true);for(const k of ['sku','article','name'])if(x[k]!==null)str(x[k]);if(x.quantity!==null)int(x.quantity,true);int(x.amountKopecks);});unique(v.rows,'row');
    if(v.returnRecoveries===undefined)v.returnRecoveries=[];
    arr(v.returnRecoveries).forEach(x=>{
      obj(x);int(x.sourceRow,true);str(x.sku);int(x.quantity,true);int(x.costKopecks,true);date(x.originalSaleDate);str(x.source);bool(x.verified);
      if(x.quantity<=0 || x.costKopecks<=0 || !['resalable','writeoff'].includes(x.condition))fail('invalid return recovery');
      const returned=v.rows.find(r=>r.row===x.sourceRow);
      if(!returned || returned.service!=='Возврат выручки' || returned.sku!==x.sku || returned.quantity!==x.quantity || x.originalSaleDate>returned.date)fail('return recovery must match full source return');
    });unique(v.returnRecoveries,'sourceRow');
  } else if(key.startsWith('tax:')) {
    const month=key.slice(4);monthBounds(month);if(v.month!==month)fail('month mismatch');str(v.entity,!v.complete);bool(v.complete);str(v.source,!v.complete);str(v.allocationSource,true);
    arr(v.events).forEach(x=>{obj(x);str(x.id);inMonth(x.date,month);if(!['income','offset','refund'].includes(x.kind))fail('invalid tax event');int(x.amountKopecks,true);str(x.source);});unique(v.events,'id');
    if(v.ozonShareBps!==null){int(v.ozonShareBps,true);if(v.ozonShareBps>10000)fail('invalid share');str(v.allocationSource);}
  } else fail('unsupported document key');
  return v;
}
function ratio(value,numerator,denominator){return int(Number((BigInt(value)*BigInt(numerator)+BigInt(denominator)/2n)/BigInt(denominator)));}
// Official report service labels verified from the source header/service vocabulary.
// These identify financial rows only; quantities still count exclusively on the two revenue labels.
const otherKnownServices = new Set(['Баллы за скидки','Временное размещение товара в СЦ/ПВЗ','Гибкий график выплат','Дополнительная обработка ОВХ','Досрочная выплата','Жалобы покупателей: привезли не тот товар','Обеспечение материалами для упаковки товара','Обработка возвратов, отмен и невыкупов партнёрами','Отгрузка в нерекомендованный слот','Отгрузка в нерекомендованный слот - отмена начисления','Перенос карточек товаров','Подготовка товара к вывозу: Валид','Программы партнёров','Страхование товара от массовых повреждений','Упаковка товара партнёрами']);
function knownService(s) {return otherKnownServices.has(s) || /^(Выручка|Возврат выручки)$/.test(s) || /комисси|вознаграждени|логист|доставк|эквайринг|продвижен|клик|premium|подписк|аналитика|склад|хранени|штраф|утилизац|обработка отправлени/i.test(s);}
export function calculateProfit({month,api,documents,costs,expenses,tax}) {
  const bounds=monthBounds(month); obj(api);if(api.totalKopecks!==null)int(api.totalKopecks);if(api.records!==null)int(api.records,true);int(api.coveredDays,true);int(api.days,true);bool(api.netVerified);bool(api.detailVerified);arr(api.components).forEach(c=>int(c.amountKopecks));arr(api.audit);
  if(api.coveredDays>bounds.days || api.days!==bounds.days)fail('invalid API coverage');
  const d=documents==null?null:validateProfitDocument('month:'+month,documents);
  const c=costs==null?{entries:[]}:validateProfitDocument('costs',costs);
  const e=expenses==null?null:validateProfitDocument('expenses',expenses);
  const t=tax==null?null:validateProfitDocument('tax:'+month,tax);
  const blockers=[],warnings=[],duplicateCandidates=[],groups=new Map(),skus=new Map(),fingerprints=new Map();
  const block=s=>{if(!blockers.includes(s))blockers.push(s);};
  if(!d)block('report_missing');
  if(api.totalKopecks===null || !api.netVerified || !api.detailVerified || api.coveredDays!==bounds.days)block('api_unverified_or_incomplete');
  let total=0,sales=0,returns=0;
  for(const r of d?.rows||[]) {
    total=sum([total,r.amountKopecks]); groups.set(r.group,sum([groups.get(r.group)||0,r.amountKopecks]));
    const fingerprint=JSON.stringify([r.date,r.service,r.group,r.sku,r.article,r.name,r.quantity,r.amountKopecks]);
    if(!fingerprints.has(fingerprint))fingerprints.set(fingerprint,[]);fingerprints.get(fingerprint).push(r.row);
    if(!knownService(r.service)){warnings.push('UNKNOWN service at row '+r.row);block('unknown_services');}
    if(r.group==='Продажи')sales=sum([sales,r.amountKopecks]);
    else if(r.group==='Возвраты')returns=sum([returns,r.amountKopecks]);
    else if(r.service==='Выручка')sales=sum([sales,r.amountKopecks]);
    else if(r.service==='Возврат выручки')returns=sum([returns,r.amountKopecks]);
    const sale=r.service==='Выручка',ret=r.service==='Возврат выручки';if(!sale && !ret)continue;
    if(ret && !d.returnRecoveries.some(x=>x.sourceRow===r.row && x.verified))block('return_recovery_unverified');
    const id=r.sku; if(!skus.has(id))skus.set(id,{sku:id,article:r.article,name:r.name,soldUnits:0,returnedUnits:0,costStatus:'confirmed',costKopecks:null,knownCostKopecks:0,reason:'',unitCosts:new Set()});
    const s=skus.get(id);
    if(r.quantity===null){block('quantity_missing');s.costStatus='missing';s.reason='quantity_missing';}
    else if(sale)s.soldUnits=sum([s.soldUnits,r.quantity]);else s.returnedUnits=sum([s.returnedUnits,r.quantity]);
    if(!sale)continue;
    const entry=c.entries.find(x=>x.sku===id && active(x,r.date));
    if(!id || !entry){s.costStatus='missing';s.reason=!id?'sku_missing':'cost_missing';block(s.reason);continue;}
    s.unitCosts.add(entry.costKopecks);
    if(entry.status!=='confirmed'){if(s.costStatus!=='missing'){s.costStatus='preliminary';s.reason='cost_preliminary';}block('cost_preliminary');}
    if(r.quantity!==null)s.knownCostKopecks=sum([s.knownCostKopecks,mul(entry.costKopecks,r.quantity)]);
  }
  if(!d) for(const component of api.components) {
    if(component.sku===null || component.sku===undefined || component.sku==='')continue;
    const sku=str(String(component.sku));if(skus.has(sku))continue;
    const entries=c.entries.filter(x=>x.sku===sku && x.validFrom<bounds.end && (x.validTo===null || x.validTo>=bounds.start));
    const monthLastDay=new Date(Date.parse(bounds.end)-86400000).toISOString().slice(0,10);
    const full=entries.find(x=>x.validFrom<=bounds.start && (x.validTo===null || x.validTo>=monthLastDay));
    const status=full?full.status:entries.length?'preliminary':'missing';
    skus.set(sku,{sku,article:null,name:component.name||null,soldUnits:null,returnedUnits:null,costStatus:status,costKopecks:null,knownCostKopecks:null,reason:status==='missing'?'cost_missing':full?'quantity_unverified':'date_effective_cost_requires_report',unitCosts:new Set(full?[full.costKopecks]:[])});
    if(status==='missing')block('cost_missing');
  }
  for(const rows of fingerprints.values())if(rows.length>1)duplicateCandidates.push(rows);
  if(duplicateCandidates.length)block('duplicate_candidates');
  if(d && !d.rows.length)block('empty_report');
  if(d && api.totalKopecks!==null && total!==api.totalKopecks)block('report_api_mismatch');
  if(d && !d.quantityVerified)block('quantity_unverified');if(d && !d.periodVerified)block('period_unverified');
  const soldKopecks=sum([...skus.values()].map(s=>s.knownCostKopecks??0));
  let recoveredKopecks=0;
  for(const recovery of d?.returnRecoveries||[])if(recovery.verified && recovery.condition==='resalable'){
    const recovered=mul(recovery.costKopecks,recovery.quantity);
    recoveredKopecks=sum([recoveredKopecks,recovered]);
    const sku=skus.get(recovery.sku);sku.knownCostKopecks=sum([sku.knownCostKopecks,-recovered]);
  }
  const skuRows=[...skus.values()].map(({unitCosts,...s})=>({...s,costKopecks:unitCosts.size===1?[...unitCosts][0]:null}));
  const known=sum(skuRows.map(s=>s.knownCostKopecks??0));
  const costsComplete=!!d && d.quantityVerified && !blockers.some(x=>['sku_missing','cost_missing','cost_preliminary','quantity_missing','return_recovery_unverified'].includes(x));
  let overhead=0,direct=0,allocationReason='',allocationKnown=true;
  if(!e){block('expenses_missing');allocationKnown=false;allocationReason='expenses_missing';}
  for(const item of e?.items||[]) {
    if(item.validFrom>=bounds.end || (item.validTo!==null && item.validTo<bounds.start))continue;
    if(item.validFrom>bounds.start || (item.validTo!==null && item.validTo<new Date(Date.parse(bounds.end)-86400000).toISOString().slice(0,10)))block('expense_partial_period');
    if(item.leatherDelivery) {
      const sold=(d?.rows||[]).filter(r=>r.service==='Выручка');
      const inclusions=sold.map(r=>c.entries.find(x=>x.sku===r.sku && active(x,r.date))?.leatherDeliveryIncluded);
      if(!inclusions.length || inclusions.some(x=>x==null) || inclusions.some(x=>x!==inclusions[0])) {block('delivery_inclusion_unknown');allocationKnown=false;allocationReason='delivery_inclusion_unknown';continue;}
      if(inclusions[0]===true){warnings.push('Delivery excluded: already included in product cost ('+item.id+')');continue;}
    }
    if(item.scope==='ozon')direct=sum([direct,item.amountKopecks]);else overhead=sum([overhead,item.amountKopecks]);
  }
  let allocated=0;
  if(overhead) {
    if(e.allocation.method==='unallocated'){allocationKnown=false;allocationReason='allocation_missing';block('allocation_missing');}
    else {const a=e.allocation,values=a.method==='shares'?a.shares:a.revenue;allocated=ratio(overhead,values.ozon,a.method==='shares'?10000:channels(values,false));}
  }
  if(!allocationKnown)block(allocationReason);
  const taxResult={baseKopecks:null,estimateKopecks:null,ozonKopecks:null,status:'missing',reason:'tax_register_missing'};
  if(t?.complete && t.entity && t.source){const base=sum(t.events.map(x=>x.kind==='refund'?-x.amountKopecks:x.amountKopecks));taxResult.baseKopecks=base;taxResult.estimateKopecks=ratio(Math.max(0,base),800,10000);taxResult.status='preliminary';taxResult.reason='preliminary_AUSN_income_8_percent_estimate';if(t.ozonShareBps!==null)taxResult.ozonKopecks=ratio(taxResult.estimateKopecks,t.ozonShareBps,10000);else taxResult.reason+=';ozon_allocation_missing';}else if(t){taxResult.status='incomplete';taxResult.reason='entity_register_incomplete';}
  const complete=blockers.length===0;
  const grossReady=!!d && d.rows.length>0 && d.periodVerified && costsComplete && !duplicateCandidates.length && !blockers.includes('unknown_services');
  const gross=grossReady?sum([sales,returns,-known]):null;
  const operating=complete?sum([api.totalKopecks,-known,-direct,-allocated]):null;
  return {month,currency:'RUB',api,report:d?{totalKopecks:total,rows:d.rows.length,salesKopecks:sales,returnsKopecks:returns,groups:[...groups].map(([name,amountKopecks])=>({name,amountKopecks})),quantityVerified:d.quantityVerified,periodVerified:d.periodVerified,sourceName:d.sourceName,sourceSha256:d.sourceSha256}:null,skuRows,costs:{soldKopecks,recoveredKopecks,knownKopecks:known,complete:costsComplete,missingSkus:skuRows.filter(s=>s.costStatus==='missing').map(s=>s.sku)},allocation:{ozonKopecks:allocationKnown?sum([direct,allocated]):null,unallocatedKopecks:allocationKnown?0:overhead,reason:allocationReason||'explicit_allocation'},tax:taxResult,profit:{grossKopecks:gross,operatingKopecks:operating,netEstimateKopecks:operating!==null && taxResult.ozonKopecks!==null?sum([operating,-taxResult.ozonKopecks]):null,partialAfterKnownCostsKopecks:api.netVerified && api.totalKopecks!==null?sum([api.totalKopecks,-known]):null,status:complete?'complete':gross!==null?'preliminary':'incomplete',blockers},warnings,duplicateCandidates};
}
const aliases={date:['дата','дата операции','дата начисления'],service:['тип начисления','услуга','наименование услуги','статья начисления','статья'],amount:['сумма итого, руб.','итого, руб.','итого руб.','сумма, руб.','сумма транзакции, руб.','сумма начисления, руб.','сумма'],group:['группа услуг','группа'],sku:['sku','ozon id','ozon sku','sku ozon'],article:['артикул','артикул продавца'],name:['название товара','наименование товара','товар'],quantity:['количество','кол-во','количество, шт.','количество товара']};
const text=x=>x==null?'':String(x).trim();
function workbookDate(x){if(typeof x==='number' || /^\d+(\.\d+)?$/.test(text(x))){x=Number(x);if(!Number.isFinite(x)||x<61)fail('invalid Excel date');return new Date(Math.floor(x-25569)*86400000).toISOString().slice(0,10);}const s=text(x);const match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);return date(match?`${match[3]}-${match[2]}-${match[1]}`:s);}
function money(x){const s=text(x).replace(/[\s\u00a0]/g,'').replace(',','.');if(!/^-?\d+(\.\d{1,2})?$/.test(s))fail('invalid financial amount');const neg=s.startsWith('-'),[whole,fraction='']=s.replace('-','').split('.');return int(Number((neg?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))));}
export function normalizeProfitWorkbook(workbook,{month,sourceName,sourceSha256}) {
  monthBounds(month);arr(workbook?.sheets);const candidates=[];
  for(const sheet of workbook.sheets)for(let i=0;i<Math.min(arr(sheet.rows).length,30);i++) {
    const names=arr(sheet.rows[i].cells).map(c=>text(c?.value).toLowerCase().replace(/\s+/g,' '));const columns={};
    for(const [key,list] of Object.entries(aliases)){const indexes=names.flatMap((n,j)=>list.includes(n)?[j]:[]);if(indexes.length>1)fail('ambiguous header '+key);if(indexes.length)columns[key]=indexes[0];}
    if(['date','service','amount'].every(k=>k in columns)){candidates.push({sheet,index:i,columns});break;}
  }
  if(candidates.length!==1)fail('report header missing or ambiguous');
  const {sheet,index,columns}=candidates[0],rows=[];
  for(const r of sheet.rows.slice(index+1)) {
    const get=k=>r.cells[columns[k]]?.value;
    if(!r.cells.some(c=>text(c?.value)))continue;
    const service=text(get('service')),amount=get('amount');
    if(!service && !text(amount) && !text(get('date')))fail('unexpected nonempty report row');
    const q=text(get('quantity'));if(q && !/^\d+$/.test(q))fail('invalid quantity');
    rows.push({row:r.rowNumber,date:inMonth(workbookDate(get('date')),month),service,group:text(get('group')),sku:text(get('sku'))||null,article:text(get('article'))||null,name:text(get('name'))||null,quantity:q?int(Number(q),true):null,amountKopecks:money(amount)});
  }
  return validateProfitDocument('month:'+month,{month,sourceName,sourceSha256,quantityVerified:false,periodVerified:false,rows});
}
