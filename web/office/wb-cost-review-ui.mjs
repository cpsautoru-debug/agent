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
   const td=(tr,text)=>{
    const cell=documentRef.createElement('td');
    cell.textContent=String(text);tr.append(cell);
   };
   for(const line of data.lines){
    const tr=documentRef.createElement('tr');
    td(tr,line.vendorCode);
    td(tr,line.soldUnits+' шт.');
    td(tr,line.product||'Нужно определить товар');
    td(tr,line.costKopecks===null?'—':fmt(line.costKopecks));
    td(tr,line.registryStatus==='confirmed'?'Запись в реестре WB подтверждена':
      line.registryStatus==='preliminary'?'Запись в реестре WB предварительная':
      'Сверено через сохранённые XLSX; реестр WB не обновлён');
    td(tr,line.reason);
    table.append(tr);
   }
   let archive='';
   try{
    const m=await fetcher('/api/wb/month-settlement?month=2026-10',{
      credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)
    });
    if(m.ok){
      const src=(await m.json()).managementCost;
      if(src?.status==='management_after_wb_charges_and_cogs'&&
         src.confirmedSkuCount===35&&src.confirmedSoldUnits===173&&
         src.resalableReturnedUnits===6)
        archive=' Для всех 35 артикулов октябрьские цены восстановлены из ранее подтверждённых XLSX; 6 возвратов пригодны к повторной продаже. Управленческая себестоимость: '+
          fmt(src.netManufacturingCostKopecks)+'.';
    }
   }catch{archive=' Историческая сверка затрат временно недоступна.';}
   if(n!==serial)return;
   status.textContent='Октябрь 2026: '+data.articles+' артикулов, '+
     data.soldUnits+' проданных единиц. Категории определены: '+
     data.candidates+'; без классификации: '+data.unknown+'.'+archive+
     ' Таблица категорий — справочная; подтверждённая октябрьская себестоимость рассчитывается из исторических XLSX. '+
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
