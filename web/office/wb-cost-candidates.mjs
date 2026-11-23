// Proposed October 2026 WB cost mapping. Read-only and intentionally
// NOT confirmed: category similarity cannot establish exact product identity.
// Values originate from previously owner-confirmed unit costs in Ozon / WB.
const rates=Object.freeze({
 vesta:{label:'Vesta',costKopecks:420000},
 cross:{label:'Vesta Cross',costKopecks:450000},
 priora:{label:'Priora',costKopecks:319900},
 samara:{label:'Samara',costKopecks:320000},
 iskra:{label:'Iskra',costKopecks:469700},
 door:{label:'Дверные вставки',costKopecks:35000},
 armrest:{label:'Подлокотник Vesta',costKopecks:10000},
 bumper:{label:'Накладка на бампер',costKopecks:30000},
 spinner:{label:'Брелок-антистресс с шестерёнками · механический спиннер',costKopecks:5000},
 fragrance:{label:'Ароматизатор для авто Dolce & Gabbana The One',costKopecks:26000}
});
export function classifyWbCostCandidate(code){
 if(typeof code!=='string'||code.length>200||!code.trim())throw Error('invalid_wb_code');
 const n=code.toLowerCase().replace(/ё/g,'е').replace(/[_\s№-]+/g,' ');
 let kind=null;
 if(code==='пламя1')kind='spinner';
 else if(code==='wb4emqym9a')kind='fragrance';
 else if(n.includes('подлокот')&&!n.includes('задним подлокотником')&&
    (n.includes('веста')||n.includes('vesta')))kind='armrest';
 else if(n.includes('накладка')&&n.includes('бампер'))kind='bumper';
 else if(n.startsWith('карты ')||n.includes('дверные карты'))kind='door';
 else if(n.includes('веста кросс')||n.includes('vesta cross'))kind='cross';
 else if(n.includes('самара'))kind='samara';
 else if(n.includes('приора'))kind='priora';
 else if(n.includes('искра'))kind='iskra';
 else if(n.includes('веста')||n.includes('vesta'))kind='vesta';
 if(!kind)return {kind:null,product:null,costKopecks:null,
   status:'unknown',reason:'Товар не классифицирован по наименованию'};
 const chosen=rates[kind];
 const special=/прем|premium|задним подлокотником|кокетк|поддержк|алька|соты|квадрат|№|номер/i.test(code);
 return {kind,product:chosen.label,costKopecks:chosen.costKopecks,
   status:'needs_owner_confirmation',
   reason:special?'Комплектация может отличаться от базовой себестоимости':
     'Нужно подтвердить применимость базовой себестоимости к этому артикулу',
   source:kind==='armrest'||kind==='bumper'||kind==='spinner'||kind==='fragrance'?
     'OWNER_WB_COST_REFERENCE':'OWNER_OZON_UNIT_COST_REFERENCE'};
}
export function proposeWbCostsFromEvidence(data,month='2026-10'){
 if(data?.code!=='entity_income_evidence'||data.month!==month||
   data.readOnly!==true||data.changedRecords!==0||
   !Array.isArray(data.wb?.costReview)||
   data.wb.costReview.length>40)throw Error('invalid_wb_cost_evidence');
 const seen=new Set();
 const lines=data.wb.costReview.map(x=>{
   if(typeof x?.vendorCode!=='string'||!x.vendorCode||
     seen.has(x.vendorCode)||!Number.isSafeInteger(x.soldUnits)||
     x.soldUnits<0||x.costStatus!=='missing'&&x.costStatus!=='preliminary'&&
     x.costStatus!=='confirmed')
     throw Error('invalid_wb_cost_review_line');
   seen.add(x.vendorCode);
   return {vendorCode:x.vendorCode,soldUnits:x.soldUnits,
     registryStatus:x.costStatus,
     ...classifyWbCostCandidate(x.vendorCode)};
 });
 const n=lines.reduce((s,x)=>s+x.soldUnits,0);
 return {month,lines,soldUnits:n,articles:lines.length,
   candidates:lines.filter(x=>x.costKopecks!==null).length,
   unknown:lines.filter(x=>x.costKopecks===null).length,
   confirmedMappings:0,writeOperations:0,
   disclaimer:'Only proposals based on category names. Do not apply or calculate WB profit until owner verifies exact SKU and historical production cost.'};
}
