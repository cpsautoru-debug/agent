import {proposeWbCostsFromEvidence} from './wb-cost-candidates.mjs';
const fmt=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100);
export function attachWbCostReview({documentRef=document,fetcher=fetch}={}){
 const panel=documentRef.getElementById('wbCostCandidates');
 const status=documentRef.getElementById('wbCostCandidatesStatus');
 const table=documentRef.getElementById('wbCostCandidatesRows');
 const refresh=documentRef.getElementById('wbCostCandidatesRefresh');
 if(!panel||!status||!table||!refresh)return false;
 let serial=0;
 async function load(){
  const n=++serial;
  status.textContent='Сверяем проданные артикулы с категориями известных затрат…';
  refresh.disabled=true;table.replaceChildren();
  try{
   const r=await fetcher('/api/finance/income-evidence?month=2026-10',{
    method:'GET',credentials:'same-origin',cache:'no-store',
    signal:AbortSignal.timeout(16000)});
   if(!r.ok)throw Error('source_unavailable');
   const data=proposeWbCostsFromEvidence(await r.json(),'2026-10');
   if(n!==serial)return;
   const td=(tr,value)=>{
    const cell=documentRef.createElement('td');
    cell.textContent=String(value);tr.append(cell);
   };
   let archive='',costMap=null;
   try{
    const m=await fetcher('/api/wb/month-settlement?month=2026-10',{
      credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)
    });
    if(m.ok){
      const source=await m.json(),c=source.managementCost;
      if(c?.status==='management_cost_reconciled'&&
         c.profitStatus==='management_after_wb_charges_and_cogs'&&
         c.confirmedSkuCount===35&&c.confirmedSoldUnits===173&&
         c.resalableReturnedUnits===6&&
         Array.isArray(c.costLines)&&c.costLines.length===35&&
         c.costLines.every(x=>typeof x.vendorCode==='string'&&
          Number.isSafeInteger(x.unitCostKopecks)&&x.unitCostKopecks>0&&
          Number.isSafeInteger(x.soldUnits)&&
          Number.isSafeInteger(x.resalableReturnedUnits)&&
          Number.isSafeInteger(x.netCostKopecks)&&
          (x.soldUnits-x.resalableReturnedUnits)*x.unitCostKopecks===x.netCostKopecks)&&
         c.costLines.reduce((a,x)=>a+x.netCostKopecks,0)===
           c.netManufacturingCostKopecks){
        costMap=new Map(c.costLines.map(x=>[x.vendorCode,x]));
        if(costMap.size!==35)throw Error('duplicate_cost_sku');
        archive=' Октябрьская себестоимость по 35 артикулам сверена с сохранёнными XLSX: '+
          fmt(c.netManufacturingCostKopecks)+'. 6 возвратов пригодны к повторной продаже.';
      }
    }
   }catch{archive=' Исторический расчёт себестоимости пока недоступен.';}
   if(n!==serial)return;
   for(const line of data.lines){
    const tr=documentRef.createElement('tr');
    const source=costMap?.get(line.vendorCode);
    td(tr,line.vendorCode);
    td(tr,line.soldUnits+' шт.');
    td(tr,line.product||'Название нужно уточнить');
    td(tr,source?fmt(source.unitCostKopecks):
      'Требуется сверка');
    td(tr,source?'Цена подтверждена в XLSX · реестр D1 не синхронизирован':
      'Только норматив по категории · не подтверждён');
    td(tr,source?'Себестоимость по подтверждённому историческому отчёту':
      line.reason);
    table.append(tr);
   }
   if(n!==serial)return;
   status.textContent='Октябрь 2026: '+data.articles+' артикулов, '+
     data.soldUnits+' проданных единиц. Категории определены: '+
     data.candidates+'; без классификации: '+data.unknown+'.'+archive+
     ' В таблице цена берётся из подтверждённой строки XLSX только при успешной сверке; цена по похожей категории не подставляется. '+
     'Основной справочник D1 ещё не синхронизирован.';
  }catch{
   if(n===serial)
    status.textContent='Не удалось получить проверенный перечень артикулов WB. Данные себестоимости не изменялись.';
  }finally{if(n===serial)refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);
 const onHash=()=>{if(location.hash.split('/')[0]==='#wbFinance')void load();};
 window.addEventListener('hashchange',onHash);
 if(location.hash.split('/')[0]==='#wbFinance')void load();
 return true;
}
if(typeof document!=='undefined')attachWbCostReview();
