import {findOzonCostSuggestions} from './wb-cost-suggestions-core.mjs';

// This is a read-only convenience layer. It never submits a cost entry.
// A selected suggestion only fills the WB editor as PRELIMINARY, with blank
// effective date and unchecked owner attestation. Owner must verify & confirm.
export function attachOzonCostSuggestions({
  documentRef=document,
  fetchCosts=fetch,
  formatCurrency=x=>new Intl.NumberFormat('ru-RU',{
    style:'currency',currency:'RUB'
  }).format(x/100)
}={}){
  const $=id=>documentRef.getElementById(id);
  const ids=['wbOzonCostHintsLoad','wbOzonCostHintsStatus',
    'wbOzonCostHintsRows','wbUnitCostVendor','wbUnitCostAmount',
    'wbUnitCostFrom','wbUnitCostSource','wbUnitCostStatus',
    'wbUnitCostAttestation','wbUnitCostPreview','wbUnitCostConfirm'];
  if(ids.some(id=>!$(id)))return false;
  const button=$('wbOzonCostHintsLoad');
  const status=$('wbOzonCostHintsStatus'),rows=$('wbOzonCostHintsRows');
  const vendor=$('wbUnitCostVendor'),amount=$('wbUnitCostAmount'),
    date=$('wbUnitCostFrom'),source=$('wbUnitCostSource'),
    quality=$('wbUnitCostStatus'),attestation=$('wbUnitCostAttestation'),
    preview=$('wbUnitCostPreview'),confirm=$('wbUnitCostConfirm');
  let busy=false;
  const clear=()=>rows.replaceChildren();
  function cell(tr,value){
    const td=documentRef.createElement('td');
    td.textContent=String(value);tr.append(td);return td;
  }
  function insertHint(candidate){
    if(vendor.disabled||!Array.from(vendor.options).some(o=>o.value===candidate.vendorCode)){
      status.textContent='Обнови таблицу WB: этот артикул сейчас недоступен для ввода.';
      return;
    }
    vendor.value=candidate.vendorCode;
    amount.value=(candidate.costKopecks/100).toFixed(2);
    // Intentionally never infer a valid-from date from Ozon history:
    date.value='';
    quality.value='preliminary';
    attestation.checked=false;
    const origin=candidate.status==='normalized_candidate_needs_owner_confirmation'?
      'Кандидат Ozon по коду: требуется сверить конкретную модель, состав и дату. ':
      'Подсказка Ozon по точному коду: проверить состав и дату. ';
    source.value=(origin+candidate.source).slice(0,250);
    for(const node of [vendor,amount,date,quality,attestation,source]){
      node.dispatchEvent(new Event('change',{bubbles:true}));
    }
    confirm.disabled=true;
    status.textContent='Подсказка подставлена как предварительная. Укажи дату действия, '+
      'проверь, что в цену входят только материалы, швея и закройщик, затем '+
      'подтверди запись через две кнопки. В D1 ничего не сохранено.';
    preview.focus();
  }
  async function load(){
    if(busy)return;
    clear();
    const wbArticles=Array.from(vendor.options)
      .map(o=>o.value)
      .filter(x=>x.length>0)
      .map(vendorCode=>({vendorCode}));
    if(!wbArticles.length||vendor.disabled){
      status.textContent='Сначала обнови расчёт WB, чтобы увидеть подтверждённые артикулы.';
      return;
    }
    busy=true;button.disabled=true;
    status.textContent='Читаем подтверждённые себестоимости Ozon и сопоставляем артикулы…';
    try{
      const response=await fetchCosts('/api/ozon/costs',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(15000)
      });
      if(!response.ok)throw Error('ozon_cost_source_unavailable');
      const body=await response.json();
      if(body?.currency!=='RUB'||!Array.isArray(body.costs))
        throw Error('ozon_cost_invalid');
      const result=findOzonCostSuggestions(wbArticles,body.costs);
      const renderCandidate=(candidate,kind)=>{
        const tr=documentRef.createElement('tr');
        cell(tr,candidate.vendorCode);
        cell(tr,candidate.model);
        cell(tr,formatCurrency(candidate.costKopecks));
        cell(tr,kind);
        const action=documentRef.createElement('td');
        const choose=documentRef.createElement('button');
        choose.type='button';
        choose.textContent='Подставить как предварительную';
        choose.className='button light';
        choose.addEventListener('click',()=>insertHint(candidate));
        action.append(choose);tr.append(action);rows.append(tr);
      };
      for(const candidate of result.suggestions)
        renderCandidate(candidate,'Точное совпадение кода');
      for(const candidate of result.normalizedCandidates)
        renderCandidate(candidate,
          'Только регистр/разделители — проверить модель и карточку');
      const s=result.sourceStats;
      const safeResults=result.suggestions.length+result.normalizedCandidates.length;
      status.textContent='Справочник Ozon: '+s.ozonCostRows+
        ' записей, подтверждённых '+s.confirmedRows+
        ', из них с артикулом продавца '+s.confirmedWithArticle+
        '. WB: '+wbArticles.length+' артикулов; точных совпадений '+
        result.suggestions.length+', кандидатов по нормализованному коду '+
        result.normalizedCandidates.length+', без точных совпадений '+
        result.notMatchedCount+', неоднозначных '+(
          result.ambiguousVendorCodes.length+
          result.normalizedAmbiguousVendorCodes.length)+'. '+
        (s.confirmedWithArticle===0?
          'Сейчас подтверждённых цен с артикулом продавца в справочнике Ozon нет. ':
          '')+
        'Подсказки не подтверждают идентичность товаров, срок действия цены и состав себестоимости.';
      if(!safeResults){
        const tr=documentRef.createElement('tr');
        cell(tr,'Автоматических кандидатов пока нет. Это не означает нулевую себестоимость.');
        rows.append(tr);
      }
    }catch{
      clear();
      status.textContent='Пока не удалось прочитать подтверждённый справочник Ozon. '+
        'Финансовые данные WB не затронуты; себестоимость можно ввести вручную.';
    }finally{button.disabled=false;busy=false;}
  }
  button.addEventListener('click',()=>{void load();});
  return true;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')
  attachOzonCostSuggestions();
