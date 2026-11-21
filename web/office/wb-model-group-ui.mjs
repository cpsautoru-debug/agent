import {buildWbModelDraft} from './wb-model-group-core.mjs';

// This panel is a read-only index of WB vendor names. Nothing is written
// to WB, Ozon, MoySklad or any cost table. There is no save button by design.
export function attachWbModelDraft({documentRef=document}={}){
  const $=id=>documentRef.getElementById(id);
  const button=$('wbModelDraftBuild');
  const status=$('wbModelDraftStatus');
  const host=$('wbModelDraftGroups');
  const vendor=$('wbUnitCostVendor');
  if(!button||!status||!host||!vendor)return false;
  const make=(name,text)=>{
    const node=documentRef.createElement(name);
    if(text!==undefined)node.textContent=text;
    return node;
  };
  const render=()=>{
    host.replaceChildren();
    if(vendor.disabled){
      status.textContent='Сначала обнови расчёт WB, чтобы получить актуальные артикулы.';
      return;
    }
    const articles=Array.from(vendor.options)
      .map(x=>x.value).filter(Boolean);
    let draft;
    try{draft=buildWbModelDraft(articles);}
    catch{
      status.textContent='Невозможно подтвердить полноту списка артикулов. Группировка скрыта.';
      return;
    }
    if(draft.totalArticles===0){
      status.textContent='Нет загруженных артикулов WB. Обнови финансовый расчёт.';
      return;
    }
    for(const group of draft.groups){
      const details=make('details');
      details.className='wb-model-draft-group';
      const summary=make('summary',
        group.label+' · '+group.articleCount+
        (group.articleCount===1?' артикул':' артикулов'));
      details.append(summary);
      const ul=make('ul');
      for(const article of group.articles){
        const item=make('li',article);
        ul.append(item);
      }
      details.append(ul);
      host.append(details);
    }
    status.textContent='Сгруппировано '+draft.totalArticles+
      ' артикулов в '+draft.groupCount+
      ' предположительных групп. Подтверждённых сопоставлений: '+
      draft.confirmedMappingCount+'. Себестоимостей назначено: '+
      draft.assignedCostCount+
      '. Модель, комплектация сидений и техкарта требуют проверки. '+
      'Список формируется только из загруженных артикулов WB; '+
      'никаких изменений в базах нет.';
  };
  button.addEventListener('click',render);
  return true;
}
if(typeof document!=='undefined'&&typeof window!=='undefined'){
  attachWbModelDraft();
}
