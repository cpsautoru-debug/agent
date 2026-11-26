const stages=[['Ожидает',null],['Раскрой',/^(раскрой|крой|раскрой материала)$/iu],['Пошив',/^пошив$/iu],['ОТК',/^(отк|контроль качества)$/iu],['Готово',/^готово к отгрузке$/iu]];
export function productionFlow(items){
 return stages.map(([name,pattern])=>{
  const matches=pattern?(items||[]).filter(s=>pattern.test(String(s.name).trim())):[];
  if(matches.length!==1)return {name,status:'Не подтверждено'};
  const s=matches[0];if(!Number.isFinite(s.plan)||s.plan<=0||!Number.isFinite(s.done)||s.done<0)return {name,status:'Не подтверждено'};
  return {name,status:s.done>=s.plan?'Этап выполнен':s.done>0?'Частично выполнен':'Выполнение не отражено',done:s.done,plan:s.plan};
 });
}
if(typeof document!=='undefined'){
 const root=document.getElementById('officeProductionStages');if(root){
  const render=data=>{root.replaceChildren(...productionFlow(data?.stages).map(x=>{const li=document.createElement('li'),title=document.createElement('strong'),state=document.createElement('span');title.textContent=x.name;state.textContent=x.status+(x.plan?' · '+x.done+' / '+x.plan:'');li.append(title,state);li.dataset.confirmed=String(x.plan!==undefined);return li}));document.getElementById('officeProductionFlowStatus').textContent=data?'Задание №'+data.number+'. Названия вне точного соответствия остаются в исходной таблице. Завершение этапа не доказывает остаток готовой продукции.':'Задание не выбрано или этапы не получены. Стадии и сроки не подтверждены.'};
  document.addEventListener('office:production-stages',e=>render(e.detail));render(null);
 }
}
