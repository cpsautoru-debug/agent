// Conservatively display WB Finance API contributions, NOT net profit.
// Product costs are explicitly entered by the Google owner via signed preview
// and immutable date-effective records in the separate WB staging D1.
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const root=el('wbUnitEconomics');
  if(!root)return;
  const ids=['wbUnitRefresh','wbUnitStatus','wbUnitRows','wbUnitCompleted',
    'wbUnitSkus','wbUnitPayout','wbUnitKnownCogs','wbUnitMissingCost',
    'wbUnitNetProfit','wbUnitScope','wbUnitBlockers','wbUnitCostForm',
    'wbUnitCostVendor','wbUnitCostAmount','wbUnitCostFrom',
    'wbUnitCostSource','wbUnitCostStatus','wbUnitCostAttestation',
    'wbUnitCostPreview','wbUnitCostConfirm','wbUnitCostMessage'];
  if(ids.some(id=>!el(id)))return;
  const number=x=>new Intl.NumberFormat('ru-RU').format(x);
  const rub=x=>Number.isSafeInteger(x)?new Intl.NumberFormat('ru-RU',{
    style:'currency',currency:'RUB'
  }).format(x/100):'Не подтверждено';
  const td=(tr,value)=>{
    const cell=document.createElement('td');
    cell.textContent=String(value);tr.append(cell);return cell;
  };
  const table=el('wbUnitRows'),message=el('wbUnitStatus'),
    refreshButton=el('wbUnitRefresh'),form=el('wbUnitCostForm'),
    select=el('wbUnitCostVendor'),confirm=el('wbUnitCostConfirm'),
    previewButton=el('wbUnitCostPreview'),costMessage=el('wbUnitCostMessage');
  const reason={
    cost_missing:'Не введена себестоимость',
    cost_version_crosses_report_period:'Изменилась цена внутри отчётного периода',
    cost_preliminary:'Себестоимость предварительная',
    return_condition_unverified:'Не подтверждено состояние возвращённых товаров'
  };
  let busy=false,latest=null,lastRead=0,preview=null;
  const visible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#wbFinance';
  const status=(text,alert=false)=>{
    message.textContent=text;
    message.className='wb-monitor-main-status'+(alert?' wb-monitor-alert':'');
  };
  const reset=()=>{
    for(const id of ['wbUnitCompleted','wbUnitSkus','wbUnitPayout',
      'wbUnitKnownCogs','wbUnitMissingCost'])el(id).textContent='—';
    el('wbUnitNetProfit').textContent='Не рассчитана';
    el('wbUnitScope').textContent='Данные из WB ещё не подтверждены.';
    el('wbUnitBlockers').textContent='Недостаточно подтверждённых данных.';
    table.replaceChildren();
    select.replaceChildren();
    const opt=document.createElement('option');
    opt.value='';opt.textContent='Артикулы пока недоступны';select.append(opt);
    form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true);
    preview=null;latest=null;confirm.disabled=true;
  };
  const costFormEnabled=value=>{
    for(const id of ['wbUnitCostVendor','wbUnitCostAmount','wbUnitCostFrom',
      'wbUnitCostSource','wbUnitCostStatus','wbUnitCostAttestation',
      'wbUnitCostPreview'])el(id).disabled=!value;
    confirm.disabled=true;
  };
  const validate=data=>{
    if(data?.code!=='wb_unit_economics_preview'||data.source!=='WB_FINANCE_API_D1'||
      data.readOnly!==true||data.changedRecords!==0||
      !['ready','migration_required'].includes(data.costRegistry)||
      data.profitVerified!==false||data.netProfitKopecks!==null||
      !Array.isArray(data.articles)||data.articles.length>1200||
      !Number.isSafeInteger(data.completeReports)||
      !Number.isSafeInteger(data.pendingReports)||
      !Number.isSafeInteger(data.skuCount)||
      data.skuCount!==data.articles.length||
      !Number.isSafeInteger(data.bankPayoutKopecks)||
      !Number.isSafeInteger(data.totalKnownManufacturingCogsKopecks)||
      !Number.isSafeInteger(data.missingCostSoldUnits)||
      !Number.isSafeInteger(data.unassignedPayoutKopecks)||
      !Number.isSafeInteger(data.unassignedFeesKopecks)||
      data.reconciliation!=='matched'||
      !Array.isArray(data.blockers)||!data.blockers.includes('advertising_missing')||
      !data.blockers.includes('shared_overheads_missing')||
      !data.blockers.includes('tax_register_missing')||
      data.articles.some(x=>!x||typeof x.vendorCode!=='string'||
        x.vendorCode.length>200||
        !Number.isSafeInteger(x.soldUnits)||!Number.isSafeInteger(x.returnedUnits)||
        !Number.isSafeInteger(x.payoutKopecks)||
        !Number.isSafeInteger(x.platformFeesKopecks)||
        !Number.isSafeInteger(x.knownManufacturingCogsKopecks)||
        !Number.isSafeInteger(x.unknownSoldUnits)||
        !Array.isArray(x.blockers)||
        x.netProfitKopecks!==null||
        (x.contributionAfterKnownCogsKopecks!==null&&
          !Number.isSafeInteger(x.contributionAfterKnownCogsKopecks))))
      throw Error('invalid_wb_profit_response');
  };
  const draw=data=>{
    validate(data);
    latest=data;
    el('wbUnitCompleted').textContent=number(data.completeReports);
    el('wbUnitSkus').textContent=number(data.skuCount);
    el('wbUnitPayout').textContent=rub(data.bankPayoutKopecks);
    el('wbUnitKnownCogs').textContent=rub(data.totalKnownManufacturingCogsKopecks)+
      (data.missingCostSoldUnits?' (неполная)':'');
    el('wbUnitMissingCost').textContent=number(data.missingCostSoldUnits);
    el('wbUnitNetProfit').textContent='Не рассчитана';
    el('wbUnitScope').textContent='Сверено '+number(data.completeReports)+
      ' отчётов; в очереди '+number(data.pendingReports)+
      '. Это периоды закрытых отчётов WB, а не полный календарный месяц. '+
      'Нераспределённые операции без артикула: '+rub(data.unassignedPayoutKopecks)+
      '; удержания без артикула: '+rub(data.unassignedFeesKopecks)+'.';
    el('wbUnitBlockers').textContent='Для чистой прибыли не хватает: '+
      'подтверждённых расходов рекламы, налогового регистра, распределения '+
      'зарплат упаковщика/водителя/управляющего, аренды и остальных накладных затрат. '+
      (data.missingCostSoldUnits?'Также не подтверждена себестоимость '+number(
        data.missingCostSoldUnits)+' проданных единиц. ':'')+
      (data.knownReturnUnits?'Возвраты требуют подтверждения состояния. ':'')+
      (data.unreconciledAdditionalFieldsKopecks?
        'Есть дополнительные поля WB, которые не входят в подтверждённую формулу сверки. ':'');
    table.replaceChildren();
    for(const x of data.articles){
      const tr=document.createElement('tr');
      if(x.blockers.length)tr.className='wb-unit-uncertain';
      td(tr,x.vendorCode);
      td(tr,number(x.soldUnits));
      td(tr,number(x.returnedUnits));
      td(tr,rub(x.payoutKopecks));
      td(tr,rub(x.platformFeesKopecks));
      td(tr,x.unknownSoldUnits?
        rub(x.knownManufacturingCogsKopecks)+' · неполная':' '+rub(x.knownManufacturingCogsKopecks));
      td(tr,x.contributionAfterKnownCogsKopecks===null?
        'Не подтверждено':rub(x.contributionAfterKnownCogsKopecks));
      td(tr,x.blockers.map(v=>reason[v]||'Нужна проверка').join('; ')||
        'Вклад после пошива · без рекламы, налогов и общих расходов');
      table.append(tr);
    }
    if(!data.articles.length){
      const row=document.createElement('tr');
      td(row,'Нет завершённых отчётов с артикулами.');
      table.append(row);
    }
    const previous=select.value;
    select.replaceChildren();
    const opt=document.createElement('option');
    opt.value='';opt.textContent='Выберите артикул из финансов WB';select.append(opt);
    for(const item of data.articles){
      const option=document.createElement('option');
      option.value=item.vendorCode;option.textContent=item.vendorCode;
      select.append(option);
    }
    if(data.articles.some(x=>x.vendorCode===previous))select.value=previous;
    costFormEnabled(data.costRegistry==='ready'&&data.articles.length>0);
    costMessage.textContent=data.costRegistry==='ready'?
      'Введите подтверждённую себестоимость, нажмите «Проверить запись», затем подтвердите сохранение.':
      'Для записи себестоимости требуется однократно применить миграцию migrations/wb/0007_wb_profit_unit_costs.sql к тестовой D1 WB. Расшифровка продаж работает без неё.';
    status('WB по артикулам: сверка выплат пройдена. Чистая прибыль ещё не подтверждена.'+
      (data.costRegistry==='migration_required'?' Справочник себестоимости пока не создан.':''),false);
  };
  const clearPreview=()=>{
    preview=null;confirm.disabled=true;
  };
  const parseRub=value=>{
    const raw=String(value).trim().replace(/\s/g,'').replace(',','.');
    if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw))throw Error('cost_invalid');
    const [whole,decimal='']=raw.split('.');
    const kop=Number(whole)*100+Number(decimal.padEnd(2,'0'));
    if(!Number.isSafeInteger(kop)||kop<=0||kop>100000000)
      throw Error('cost_invalid');
    return kop;
  };
  const getDocument=()=>{
    if(!latest||latest.costRegistry!=='ready')throw Error('cost_registry_not_ready');
    const vendor=select.value;
    if(!latest.articles.some(x=>x.vendorCode===vendor))
      throw Error('vendor_unverified');
    const raw={
      vendor_code:vendor,
      valid_from:el('wbUnitCostFrom').value,
      valid_to:null,
      cost_kopecks:parseRub(el('wbUnitCostAmount').value),
      status:el('wbUnitCostStatus').value,
      source:el('wbUnitCostSource').value.trim()
    };
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw.valid_from)||
      raw.source.length<3||raw.source.length>250||
      !['preliminary','confirmed'].includes(raw.status))
      throw Error('cost_form_incomplete');
    if(!el('wbUnitCostAttestation').checked)
      throw Error('cost_attestation_required');
    return raw;
  };
  const post=async payload=>{
    const res=await fetch('/api/wb/unit-costs',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(14000)
    });
    const data=await res.json();
    if(!res.ok||!data?.code)throw Error(data?.code||'cost_service_unavailable');
    return data;
  };
  const load=async(force=false)=>{
    if(busy||!visible()&&!force)return;
    if(!force&&lastRead&&Date.now()-lastRead<5*60*1000)return;
    busy=true;refreshButton.disabled=true;
    clearPreview();
    status('Сверяем артикулы завершённых отчётов WB с сохранёнными операциями…');
    lastRead=Date.now();
    try{
      const response=await fetch('/api/wb/unit-economics',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)
      });
      if(response.status===401||response.status===403){
        reset();
        status('Требуется вход владельца через Google для просмотра прибыли WB.',true);
        return;
      }
      if(!response.ok){
        // API returns only predefined privacy-safe codes; never present
        // DB exception details, cookies, SQL fragments or private rows.
        let errorCode='unit_economics_api_unavailable';
        try{
          const failure=await response.json();
          if([
            'wb_profit_payout_reconciliation_failed',
            'wb_profit_operation_coverage_invalid',
            'wb_profit_coverage_unavailable',
            'wb_profit_cost_register_incomplete'
          ].includes(failure?.code))errorCode=failure.code;
          else if(failure?.code==='wb_profitability_unavailable'&&
            ['completed_report_aggregation','cost_registry_probe',
              'cost_registry_read','reconciliation'].includes(failure?.stage))
            errorCode='wb_profitability_unavailable_'+failure.stage;
        }catch{}
        throw Error(errorCode);
      }
      draw(await response.json());
    }catch(error){
      reset();
      const reasons={
        wb_profit_payout_reconciliation_failed:
          'Детализация по артикулам не совпала с выплатами WB. Расчёт заблокирован для защиты финансовых данных.',
        wb_profit_operation_coverage_invalid:
          'Число операций по артикулам не совпало с завершёнными отчётами. Расчёт заблокирован.',
        wb_profit_coverage_unavailable:
          'Источник данных по артикулам неполный или превышен лимит. Требуется проверка охвата.',
        wb_profit_cost_register_incomplete:
          'Справочник себестоимости неполный. Проверьте его состояние.',
        wb_profitability_unavailable_completed_report_aggregation:
          'Ошибка чтения строк завершённых финансовых отчётов. Основной монитор WB работает отдельно.',
        wb_profitability_unavailable_cost_registry_probe:
          'Не удалось проверить таблицу себестоимости в финансовой D1.',
        wb_profitability_unavailable_cost_registry_read:
          'Не удалось прочитать сохранённый справочник себестоимости.',
        wb_profitability_unavailable_reconciliation:
          'Не удалось проверить корректность детализации по артикулам.'
      };
      status((reasons[error?.message]||
        'Невозможно подтвердить расшифровку по артикулам. Данные скрыты; проверьте доступ к финансовой D1.')+
        ' Код: '+(Object.hasOwn(reasons,error?.message)?
          error.message:'wb_unit_economics_unavailable'),true);
    }finally{busy=false;refreshButton.disabled=false;}
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    clearPreview();busy=true;previewButton.disabled=true;
    try{
      const document=getDocument();
      const data=await post({action:'preview',document,
        explicitlyConfirmed:document.status==='confirmed'});
      if(data.code!=='wb_cost_preview'||typeof data.token!=='string')
        throw Error('invalid_preview');
      preview={document,token:data.token,explicitlyConfirmed:
        document.status==='confirmed'};
      confirm.disabled=false;
      costMessage.textContent='Предпросмотр подтверждён: '+document.vendor_code+
        ' · '+rub(document.cost_kopecks)+' за единицу с '+document.valid_from+
        '. Нажмите «Сохранить подтверждённую запись» в течение 10 минут.';
    }catch(error){
      costMessage.textContent='Не удалось подтвердить себестоимость: '+
        String(error?.message||'unknown').slice(0,70);
    }finally{busy=false;previewButton.disabled=false;}
  });
  confirm.addEventListener('click',async()=>{
    if(!preview||busy)return;
    let same;
    try{same=getDocument();}
    catch{clearPreview();costMessage.textContent='Запись изменена. Проверьте заново.';return;}
    if(JSON.stringify(same)!==JSON.stringify(preview.document)){
      clearPreview();costMessage.textContent='Запись изменена. Проверьте заново.';return;
    }
    busy=true;confirm.disabled=true;
    try{
      const data=await post({action:'confirm',document:preview.document,
        token:preview.token,explicitlyConfirmed:preview.explicitlyConfirmed});
      if(data.code!=='wb_cost_saved'||data.changedRecords!==1)
        throw Error('cost_save_not_confirmed');
      const article=data.vendorCode;
      clearPreview();
      busy=false;
      await load(true);
      costMessage.textContent='Себестоимость артикула '+article+
        ' сохранена отдельной датированной записью. Отчёты WB не изменялись.';
    }catch(error){
      clearPreview();
      costMessage.textContent='Сохранение не подтверждено: '+
        String(error?.message||'unknown').slice(0,70)+
        '. Проверьте запись в справочнике перед повтором.';
    }finally{busy=false;}
  });
  for(const id of ['wbUnitCostVendor','wbUnitCostAmount','wbUnitCostFrom',
    'wbUnitCostSource','wbUnitCostStatus','wbUnitCostAttestation']){
    const input=el(id);
    input.addEventListener('input',clearPreview);
    input.addEventListener('change',clearPreview);
  }
  refreshButton.addEventListener('click',()=>{void load(true);});
  window.addEventListener('hashchange',()=>{void load();});
  document.addEventListener('visibilitychange',()=>{if(visible())void load();});
  window.setInterval(()=>{void load();},60*1000);
  // Never trigger a global load on other office sections.
  void load();
})();
