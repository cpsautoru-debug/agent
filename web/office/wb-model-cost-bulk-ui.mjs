import {validateModelCostBatch} from './wb-model-cost-bulk-core.mjs';

const eligible=new Set(['door_inserts','vesta_cross','vesta_sw','vesta',
  'priora','iskra','samara','granta','niva_travel','creta','rio']);
const kopFromRub=value=>{
  const text=String(value).trim().replace(/[\s\u00a0]/g,'').replace(',','.');
  if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(text))
    throw Error('invalid_cost_rubles');
  const [units,frac='']=text.split('.');
  const n=Number(units)*100+Number(frac.padEnd(2,'0'));
  if(!Number.isSafeInteger(n)||n<=0||n>100000000)
    throw Error('invalid_cost_rubles');
  return n;
};
// Called only after the owner has opened the draft model family and
// reviewed all the candidate article names. No background network requests.
export function mountModelCostReview({
  documentRef=document,parent,group,
  post=fetch
}={}){
  if(!parent||!eligible.has(group?.id)||
    !Array.isArray(group.articles)||group.articles.length<1||
    group.articles.length>25)return false;
  const e=(tag,text)=>{
    const node=documentRef.createElement(tag);
    if(text!==undefined)node.textContent=text;
    return node;
  };
  const wrap=e('details');wrap.className='wb-model-cost-review';
  wrap.append(e('summary','Назначить себестоимость выбранным артикулам группы'));
  const intro=e('p','Черновая модель определена по названию, а не по техкарте. '+
    'Отметь только изделия с ОДИНАКОВОЙ реальной себестоимостью. '+
    'Не выбирай товары, если цвет/материал/пошив/комплектация отличаются по стоимости.');
  wrap.append(intro);
  const form=e('form');form.className='wb-model-cost-form';
  const list=e('div');list.className='wb-model-cost-list';
  const checkboxes=[];
  for(const code of group.articles){
    const label=e('label');
    const tick=e('input');tick.type='checkbox';tick.value=code;
    tick.checked=false;tick.className='wb-model-code-tick';
    checkboxes.push(tick);label.append(tick,e('span',code));list.append(label);
  }
  form.append(list);
  const selectAll=e('button','Выбрать все артикулы группы');
  selectAll.type='button';selectAll.className='button light';
  form.append(selectAll);
  const fields=e('div');fields.className='wb-model-cost-fields';
  function field(labelText,type,placeholder){
    const label=e('label',labelText);
    const input=e('input');input.type=type;
    if(placeholder)input.placeholder=placeholder;
    input.required=true;
    label.append(input);fields.append(label);return input;
  }
  const amount=field('Производственная себестоимость одной единицы, ₽',
    'text','Например, 4200,00');
  amount.inputMode='decimal';amount.maxLength=15;
  const date=field('Действует с даты — должна покрывать нужный период WB','date');
  const source=field('Основание: подтверждённая техкарта и расценки',
    'text','Номер техкарты, состав и дата');source.maxLength=200;
  const qualityLabel=e('label','Качество себестоимости');
  const quality=e('select');
  for(const [value,name] of [
    ['preliminary','Предварительная — не участвует в подтверждённой прибыли'],
    ['confirmed','Подтверждённая — проверены товар, цена и период']
  ]){
    const opt=e('option',name);opt.value=value;quality.append(opt);
  }
  quality.value='preliminary';qualityLabel.append(quality);fields.append(qualityLabel);
  form.append(fields);
  function attest(text){
    const label=e('label');label.className='wb-model-cost-attestation';
    const checkbox=e('input');checkbox.type='checkbox';
    label.append(checkbox,e('span',text));form.append(label);
    return checkbox;
  }
  const same=attest('Каждый выбранный артикул — одно и то же изделие, '+
    'комплектация и реальная техкарта; групповая себестоимость подходит всем.');
  const composition=attest('В цену входят только материалы, швея и '+
    'закройщик. Упаковщик, водитель, управляющий, реклама, налог, аренда — отдельно.');
  const explicit=attest('Подтверждаю точность суммы, даты и основания; '+
    'понимаю, что запись в D1 после сохранения неизменяема.');
  const buttons=e('div');buttons.className='wb-model-cost-buttons';
  const previewButton=e('button','Проверить выбранные цены');
  previewButton.type='submit';previewButton.className='button light';
  const confirmButton=e('button','Сохранить после проверки');
  confirmButton.type='button';confirmButton.className='button primary';
  confirmButton.disabled=true;
  buttons.append(previewButton,confirmButton);form.append(buttons);
  const status=e('p','Пока записи не выполнялись. Артикулы не выбраны.');
  status.className='wb-monitor-meta';status.setAttribute('role','status');
  form.append(status);wrap.append(form);parent.append(wrap);
  let locked=false,preview=null;
  const clear=()=>{preview=null;confirmButton.disabled=true;};
  for(const tick of checkboxes)tick.addEventListener('change',clear);
  for(const input of [amount,date,source,quality,same,composition,explicit]){
    input.addEventListener('input',clear);
    input.addEventListener('change',clear);
  }
  selectAll.addEventListener('click',()=>{
    for(const tick of checkboxes)tick.checked=true;
    clear();
    status.textContent='Выбраны все артикулы этой группы. '+
      'Проверь каждый: одинаковая ли себестоимость и техкарта.';
  });
  const build=()=>validateModelCostBatch({
    familyId:group.id,
    vendorCodes:checkboxes.filter(x=>x.checked).map(x=>x.value),
    costKopecks:kopFromRub(amount.value),
    validFrom:date.value,
    status:quality.value,
    source:source.value.trim(),
    sameTechCardConfirmed:same.checked,
    includesMaterialsSeamstressCutterOnly:composition.checked,
    explicitlyConfirmed:explicit.checked
  });
  const submit=async payload=>{
    const res=await post('/api/wb/model-cost-batch',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)
    });
    const result=await res.json();
    if(!res.ok)throw Error(result?.code||'wb_batch_unavailable');
    return result;
  };
  const messages={
    invalid_model_cost_batch:'Проверь группу, сумму, дату, источник и все подтверждения.',
    wb_articles_changed_refresh_required:'Список артикулов изменился. Обнови расчёт WB.',
    existing_cost_version_requires_individual_review:
      'Хотя бы один товар уже имеет себестоимость. Не выполняй групповую запись: проверь цену этого артикула отдельно.',
    batch_preview_expired_or_changed:'Предпросмотр устарел или изменился. Проверь заново.',
    configuration_unavailable:'Не настроена привязка финансовой базы для записи.',
    wb_model_cost_batch_unavailable:'Нет подтверждения сохранения. Проверь наличие записей перед повтором.',
    batch_write_not_verified:'Финансовая база не подтвердила групповую запись.'
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(locked)return;
    clear();
    let doc;
    try{doc=build();}
    catch{
      status.textContent='Выбери только одинаковые товары, введи цену, действительную дату, '+
        'техкарту и поставь все три отметки подтверждения.';
      return;
    }
    locked=true;previewButton.disabled=true;
    try{
      const data=await submit({action:'preview',document:doc});
      if(data.code!=='wb_model_cost_batch_preview'||data.changedRecords!==0||
        !Array.isArray(data.vendorCodes)||
        data.vendorCodes.join('|')!==doc.vendorCodes.join('|')||
        data.count!==doc.vendorCodes.length||data.costKopecks!==doc.costKopecks||
        typeof data.token!=='string')throw Error('preview_unverified');
      preview={document:doc,token:data.token};
      confirmButton.disabled=false;
      status.textContent='Подготовлено к записи: '+data.count+' артикулов из группы '+
        group.label+', по '+(doc.costKopecks/100).toFixed(2)+
        ' ₽ за единицу, с '+doc.validFrom+
        ' — '+doc.status+'. НИЧЕГО ЕЩЁ НЕ СОХРАНЕНО. '+
        'Для завершения нажми «Сохранить после проверки» в течение 10 минут.';
    }catch(error){
      status.textContent=messages[error?.message]||
        'Не удалось получить подтверждение предпросмотра. Запись не отправлена.';
    }finally{locked=false;previewButton.disabled=false;}
  });
  confirmButton.addEventListener('click',async()=>{
    if(locked||!preview)return;
    let doc;
    try{doc=build();}
    catch{clear();status.textContent='Форма изменилась. Проверь заново.';return;}
    if(JSON.stringify(doc)!==JSON.stringify(preview.document)){
      clear();status.textContent='Форма изменилась. Проверь заново.';return;
    }
    locked=true;confirmButton.disabled=true;previewButton.disabled=true;
    try{
      const data=await submit({action:'confirm',document:doc,token:preview.token});
      if(data.code!=='wb_model_cost_batch_saved'||
        data.changedRecords!==doc.vendorCodes.length)
        throw Error('batch_write_not_verified');
      status.textContent='Финансовая D1 подтвердила '+data.changedRecords+
        ' новые записи. Исходные операции WB не менялись. '+
        'Нажми «Обновить расчёт» выше для проверки себестоимости.';
      preview=null;
    }catch(error){
      clear();
      status.textContent=messages[error?.message]||
        'Сохранение не подтверждено. Перед повтором проверь текущую базу.';
    }finally{locked=false;previewButton.disabled=false;}
  });
  return true;
}
