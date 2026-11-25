import {readCompletePages} from './fulfillment-occupancy.mjs';

const BASE='https://api.moysklad.ru/api/remap/1.2/entity/';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unknown={status:'production_unverified',jobs:[]};
const number=x=>Number.isFinite(x)&&x>=0&&x<=1e8;
function idOf(ref,path){
 const href=ref?.meta?.href;
 const root=BASE+path+'/';
 const id=typeof href==='string'&&href.startsWith(root)?href.slice(root.length):'';
 return ID.test(id)?id:null;
}
function assortment(ref){
 return ['product','variant','bundle'].map(type=>idOf(ref,type)).find(Boolean);
}
function complete(data,limit){
 const rows=data?.rows;
 if(!Array.isArray(rows)||rows.length>limit||data.meta?.size!==rows.length||
  data.meta?.nextHref||new Set(rows.map(row=>row?.id)).size!==rows.length||
  rows.some(row=>!ID.test(row?.id||'')))throw Error();
 return rows;
}
function deadline(value){
 // JSON API document timestamps are in Moscow time.
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{3})?$/.test(value))
  return null;
 const date=new Date(value.replace(' ','T')+'+03:00');
 return Number.isFinite(+date)?date.toISOString():null;
}

export async function readProduction(itemId,storeId,read){
 if(!ID.test(itemId||'')||!ID.test(storeId||''))return unknown;
 try{
  const tasks=await readCompletePages(read,'entity/productiontask',{limit:50,maxPages:16});
  const jobs=[];
  for(const task of tasks){
   const warehouse=idOf(task.productsStore,'store');
   if(!warehouse)throw Error();
   if(warehouse!==storeId)continue;
   const base='productiontask/'+task.id;
   const products=complete(await read('entity/'+base+'/products?limit=200'),200);
   if(products.some(product=>!assortment(product.assortment)))throw Error();
   const matching=products.filter(product=>assortment(product.assortment)===itemId);
   if(!matching.length)continue;
   if(task.applicable!==true)throw Error();
   const links=Array.isArray(task.customerOrders)?task.customerOrders.map(ref=>idOf(ref,'customerorder')):null;
   if(!links||links.some(id=>!id)||new Set(links).size!==links.length)throw Error();
   const rows=complete(await read('entity/'+base+'/productionRows?limit=200'),200);
   const filter=new URLSearchParams({limit:'200',filter:'productionTask='+BASE+base});
   const stages=complete(await read('entity/productionstage?'+filter),200);
   if(stages.some(s=>idOf(s.productionTask,'productiontask')!==task.id||
     !idOf(s.productionRow,base+'/productionRows')))throw Error();
   const due=deadline(task.deliveryPlannedMoment);
   for(const product of matching){
    const rowId=idOf(product.productionRow,base+'/productionRows');
    const row=rows.find(r=>r.id===rowId);
    const rowStages=stages.filter(s=>idOf(s.productionRow,base+'/productionRows')===rowId)
     .sort((a,b)=>a.orderingPosition-b.orderingPosition);
    if(!row||!idOf(row.processingPlan,'processingplan')||!number(row.productionVolume)||
      row.productionVolume<=0||!number(product.planQuantity)||!rowStages.length||
      rowStages.some((s,i)=>s.orderingPosition!==i||s.totalQuantity!==row.productionVolume||
       !number(s.completedQuantity)||s.completedQuantity>s.totalQuantity||
       (i>0&&s.completedQuantity>rowStages[i-1].completedQuantity)))throw Error();
    const ratio=rowStages.at(-1).completedQuantity/row.productionVolume;
    const completed=product.planQuantity*ratio;
    const pending=product.planQuantity-completed;
    if(pending>0&&(!due||task.awaiting!==true||task.productionEnd))throw Error();
    jobs.push({id:task.id,productLineId:product.id,storeId,completed,pending,due,
     customerOrderIds:links});
   }
  }
  return {status:'production_verified',jobs};
 }catch{return unknown;}
}

export function allocateProduction(jobs,lines){
 const remaining=jobs.map(job=>Math.floor(job.pending));
 const result=lines.map(line=>({key:line.key,planned:0,missing:line.missing,taskIds:[]}));
 for(const linked of [true,false]){
  lines.forEach((line,i)=>{
   if(!line.deadline)return;
   jobs.forEach((job,j)=>{
    if(!job.due||Date.parse(job.due)>Date.parse(line.deadline)||
      (linked?job.customerOrderIds.length!==1||job.customerOrderIds[0]!==line.orderId:
       job.customerOrderIds.length!==0))return;
    const used=Math.min(remaining[j],result[i].missing);
    if(!used)return;
    remaining[j]-=used;
    result[i].planned+=used;
    result[i].missing-=used;
    if(!result[i].taskIds.includes(job.id))result[i].taskIds.push(job.id);
   });
  });
 }
 return result;
}
