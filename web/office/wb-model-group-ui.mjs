import {buildWbModelDraft} from './wb-model-group-core.mjs';
import {mountModelCostReview} from './wb-model-cost-bulk-ui.mjs';

// Draft model grouping is read-only. Each eligible group offers an OPTIONAL
// separately reviewed, signed two-step cost insertion into the existing WB
// staging COGS register. Nothing is written by merely building groups.
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
      mountModelCostReview({documentRef, parent:details,group});
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
