/* Owner-only profit drafts. No browser persistence, no automatic writes. */
(function () {
  'use strict';
  function createProfitWorkflow(send) {
    let revision = 0, ready = null;
    return {
      clear() { revision++; ready = null; },
      async preview(key, value) {
        const current = ++revision; ready = null;
        const snapshot = JSON.parse(JSON.stringify(value));
        const result = await send({action:'preview', key, value:snapshot});
        if (current !== revision) return null;
        ready = {token:result.token, key, value:snapshot, expiresAt:result.expiresAt};
        return result;
      },
      async confirm() {
        if (!ready?.token) throw new Error('Сначала выполните предпросмотр.');
        const value = ready; ready = null; revision++;
        if (value.expiresAt && new Date(value.expiresAt).getTime() <= Date.now()) throw new Error('Срок предпросмотра истёк. Повторите проверку.');
        return send({action:'confirm', token:value.token, key:value.key, value:value.value});
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createProfitWorkflow};
  if (typeof document === 'undefined') return;
  const root = document.querySelector('[data-section="ozonProfit"]');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const money = value => value == null ? 'Неизвестно' : new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);
  const json = value => JSON.stringify(value ?? null, null, 2);
  const message = text => { $('profitMessage').textContent = text; };
  let generation = 0, monthDocument = null, busy = false, pendingLoad = false, audit = [];
  async function request(body) {
    const response = await fetch('/api/ozon/profit', {method:'POST',credentials:'same-origin',cache:'no-store', ...(body instanceof FormData ? {body} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Требуется вход владельца в разделе «Финансы · Ozon».' : data.error || data.message || 'Не удалось выполнить запрос.');
    return data;
  }
  const workflow = createProfitWorkflow(request);
  function clear() { generation++; workflow.clear(); $('profitConfirm').disabled = true; $('profitPreview').hidden = true; }
  function setBusy(value) { busy = value; root.querySelectorAll('[data-profit-action]').forEach(button => button.disabled = value); if (value) $('profitConfirm').disabled = true; }
  async function run(action) {
    if (busy) return; setBusy(true); message('Проверка…');
    try { await action(); } catch(error) { clear(); message(error.message || 'Ошибка запроса.'); }
    finally { setBusy(false); if (pendingLoad) { pendingLoad = false; run(load); } }
  }
  function preview(result) {
    if (!result) return;
    $('profitBefore').textContent = json(result.before);
    $('profitAfter').textContent = json(result.after);
    $('profitWarnings').textContent = (result.warnings || []).map(w => explain(w)).join('\n') || 'Предупреждений сервера нет. Проверьте изменения перед сохранением.';
    $('profitExpiry').textContent = result.expiresAt ? 'Предпросмотр действует до: ' + result.expiresAt : '';
    $('profitPreview').hidden = false; $('profitConfirm').disabled = false;
    message('Черновик проверен. Изменения ещё не сохранены.');
  }
  const explanations = {
    complete:'Расчёт готов', incomplete:'Расчёт неполный', preliminary:'Предварительно', missing:'Нет данных', confirmed:'Подтверждено', blocked:'Расчёт заблокирован', unknown:'Неизвестно',
    report_missing:'Отчёт начислений не загружен.', api_unverified_or_incomplete:'Начисления API не полностью загружены или сверены.', unknown_services:'В отчёте есть неизвестные услуги: проверьте их классификацию.', quantity_missing:'В строках отчёта не указано количество.', sku_missing:'В строках отчёта не указан SKU.', cost_missing:'Не указана себестоимость для товара и даты продажи.', cost_preliminary:'Себестоимость пока предварительная.', return_recovery_unverified:'Для возвратов не проверены исходная себестоимость и состояние товара.', quantity_unverified:'Количество продаж не подтверждено владельцем.', date_effective_cost_requires_report:'Для себестоимости по датам нужен отчёт с датами продаж.', duplicate_candidates:'В отчёте есть возможные дубли строк.', empty_report:'В отчёте нет строк.', report_api_mismatch:'Итог отчёта расходится с сальдо API.', period_unverified:'Период отчёта не подтверждён владельцем.', expenses_missing:'Расходы ещё не указаны.', expense_partial_period:'Расход действует только часть месяца: проверьте период.', delivery_inclusion_unknown:'Неизвестно, включена ли доставка кожи в себестоимость.', allocation_missing:'Не задано распределение общих расходов между каналами.', explicit_allocation:'Расходы распределены по указанному основанию.', tax_register_missing:'Реестр налоговых событий ещё не загружен.', entity_register_incomplete:'Реестр событий организации неполон.', preliminary_AUSN_income_8_percent_estimate:'Предварительная оценка АУСН «Доходы» 8% по событиям организации.', ozon_allocation_missing:'Для налога не указана подтверждённая доля Ozon.', return_cost_unverified:'Исходная себестоимость возврата не подтверждена.', return_condition_unverified:'Состояние возвращённого товара не подтверждено.'
  };
  function explain(value) {
    if(value == null || value === '')return '';
    if(typeof value !== 'string')return 'Есть замечание к исходным данным. Проверьте документ и его источник.';
    if(explanations[value])return explanations[value];
    if(value.includes(';'))return value.split(';').map(explain).join(' ');
    const unknown=value.match(/^UNKNOWN service at row (\d+)$/);if(unknown)return 'Неизвестная услуга в строке '+unknown[1]+'. Проверьте классификацию.';
    if(value.startsWith('Delivery excluded:'))return 'Доставка кожи уже включена в себестоимость товара и повторно не вычитается.';
    return /[А-Яа-яЁё]/.test(value)?value:'Требуется дополнительная проверка исходных данных. Проверьте документ и его источник.';
  }
  function cell(row, value) { const node = document.createElement('td'); node.textContent = value == null ? 'Неизвестно' : String(value); row.append(node); return node; }
  function table(id, rows) { const body = $(id); body.replaceChildren(); rows.forEach(values => { const row = document.createElement('tr'); values.forEach(value => cell(row,value)); body.append(row); }); }
  function render(result) {
    const values = [['Продажи · по отчёту',result.report?.salesKopecks],['Возвраты · по отчёту',result.report?.returnsKopecks],['Валовая прибыль',result.profit?.grossKopecks],['Операционная прибыль',result.profit?.operatingKopecks],['Чистая прибыль · оценка',result.profit?.netEstimateKopecks],['После известных затрат · частичный итог',result.profit?.partialAfterKnownCostsKopecks],['Сальдо API · после удержаний Ozon',result.api?.totalKopecks],['Себестоимость · известная часть',result.report?result.costs?.knownKopecks:null],['Внешние расходы Ozon · прямые и распределённые',result.allocation?.ozonKopecks],['АУСН «Доходы» 8% · доля Ozon, оценка',result.tax?.ozonKopecks]];
    $('profitCards').replaceChildren(); values.forEach(([label,value])=> {const card=document.createElement('article');card.className='profit-card';const title=document.createElement('h3');title.textContent=label;const amount=document.createElement('strong');amount.textContent=money(value);card.append(title,amount);$('profitCards').append(card);});
    $('profitStatus').textContent = 'Статус: ' + explain(result.profit?.status || 'unknown') + '\n' + [...(result.profit?.blockers || []),...(result.warnings || [])].map(v=>explain(v)).join('\n');
    $('profitReasons').textContent = ['API: покрытие '+(result.api?.coveredDays ?? 'неизвестно')+' / '+(result.api?.days ?? 'неизвестно')+' дней; нетто '+(result.api?.netVerified?'сверено':'не подтверждено')+'; детализация '+(result.api?.detailVerified?'сверена':'не подтверждена'), 'Себестоимость: '+(result.costs?.complete?'полная':'неполная'), 'Неизвестные SKU: '+(result.costs?.missingSkus || []).join(', '),'Нераспределённые расходы: '+money(result.allocation?.unallocatedKopecks),explain(result.allocation?.reason),'Налоговая база организации: '+money(result.tax?.baseKopecks)+'; АУСН «Доходы» 8%, оценка по организации: '+money(result.tax?.estimateKopecks)+'; статус: '+explain(result.tax?.status || 'unknown'),explain(result.tax?.reason)].filter(Boolean).join('\n');
    table('profitSkuRows',(result.skuRows || []).map(r=>[r.sku,r.article,r.name,r.soldUnits,r.returnedUnits,explain(r.costStatus),money(r.costKopecks),money(r.knownCostKopecks),explain(r.reason)]));
    table('profitGroupRows',(result.report?.groups || []).map(r=>[r.name,money(r.amountKopecks)]));
    $('profitReportStatus').textContent=result.report ? `Источник: ${result.report.sourceName}; количество: ${result.report.quantityVerified?'подтверждено':'не проверено'}; период: ${result.report.periodVerified?'подтверждён':'не проверен'}.` : 'Отчёт начислений не загружен.';
    $('profitDuplicates').textContent=json(result.duplicateCandidates || []);
  }
  function inputCell(row, value, type, label) {const td=document.createElement('td'),input=document.createElement('input');input.type=type;input.value=value ?? '';input.setAttribute('aria-label',label);td.append(input);row.append(td);return input;}
  function selectCell(row, value, options, label) {const td=document.createElement('td'),select=document.createElement('select');select.setAttribute('aria-label',label);options.forEach(([v,l])=> {const option=document.createElement('option');option.value=v;option.textContent=l;select.append(option);});select.value=String(value);td.append(select);row.append(td);return select;}
  function addCost(entry={}) {
    const row=document.createElement('tr');
    inputCell(row,entry.sku,'text','SKU');const amount=inputCell(row,entry.costKopecks==null?'':(entry.costKopecks/100).toFixed(2),'number','Себестоимость комплекта, рубли');amount.min='0';amount.step='0.01';
    inputCell(row,entry.validFrom,'date','Действует с');inputCell(row,entry.validTo,'date','Действует по');
    selectCell(row,entry.status || 'preliminary',[['preliminary','Предварительная'],['confirmed','Подтверждённая']],'Статус');
    inputCell(row,entry.source,'text','Источник');selectCell(row,entry.leatherDeliveryIncluded ?? 'unknown',[['unknown','Неизвестно'],['true','Включена'],['false','Не включена']],'Доставка кожи в себестоимости');
    const td=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.textContent='Удалить';remove.addEventListener('click',()=>{clear();row.remove();});td.append(remove);row.append(td);$('profitCostRows').append(row);
  }
  function costs() {
    return {entries:Array.from($('profitCostRows').children).map(row=>{
      const [sku,amount,from,to,status,source,leather]=row.querySelectorAll('input,select');
      if (!sku.value.trim() || !/^\d+(\.\d{1,2})?$/.test(amount.value)) throw new Error('Укажите SKU и себестоимость в рублях с точностью до копейки.');
      const kopecks=Math.round(Number(amount.value)*100);if (!Number.isSafeInteger(kopecks)) throw new Error('Сумма слишком велика.');
      return {sku:sku.value.trim(),costKopecks:kopecks,validFrom:from.value,validTo:to.value || null,status:status.value,source:source.value.trim(),leatherDeliveryIncluded:leather.value==='unknown'?null:leather.value==='true'};
    })};
  }
  function renderAudit() {
    const selected=$('profitAuditKey').value;
    $('profitAudit').textContent=json(selected==='all'?audit:audit.filter(entry=>(entry.key || entry.document_key)===(selected==='month'||selected==='tax'?selected+':'+$('profitMonth').value:selected)));
  }
  function scheduleLoad() { if (busy) pendingLoad=true; else run(load); }
  async function load() {
    const current=++generation; workflow.clear();$('profitConfirm').disabled=true;$('profitPreview').hidden=true;message('Загрузка…');
    render({}); $('profitCostRows').replaceChildren(); $('profitExpenses').value=''; $('profitTax').value=''; audit=[];renderAudit();$('profitVersions').textContent=''; monthDocument=null;
    $('profitQuantity').checked=false;$('profitPeriod').checked=false;$('profitFile').value='';$('profitMonthDraft').textContent='';$('profitRecoveries').value='[]';$('profitReturnRows').textContent='[]';
    const month=$('profitMonth').value;if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Выберите месяц.');
    const response=await fetch('/api/ozon/profit?month='+encodeURIComponent(month),{credentials:'same-origin',cache:'no-store'});
    const data=await response.json(); if(current!==generation)return;
    if(!response.ok)throw new Error(response.status===401||response.status===403?'Требуется вход владельца в разделе «Финансы · Ozon».':data.error || 'Не удалось загрузить расчёт.');
    render(data.result);const config=data.configuration || {};
    $('profitCostRows').replaceChildren();(config.costs?.entries || []).forEach(addCost);
    $('profitExpenses').value=config.expenses?json(config.expenses):'';
    $('profitTax').value=config.tax?json(config.tax):'';
    monthDocument=config.month || null;$('profitQuantity').checked=false;$('profitPeriod').checked=false;
    $('profitRecoveries').value=json(monthDocument?.returnRecoveries || []);$('profitReturnRows').textContent=json((monthDocument?.rows || []).filter(row=>row.service==='Возврат выручки'));
    $('profitFile').value='';$('profitMonthDraft').textContent=monthDocument?'Сохранённый отчёт доступен. Для изменения проверок установите флажки и выполните предпросмотр.':'Выберите XLSX отчёт за выбранный месяц.';
    audit=data.audit || [];renderAudit();$('profitVersions').textContent='Версии документов: '+json(data.versions || {});message('Данные загружены. Изменения редакторов остаются черновиками до подтверждения.');
  }
  root.addEventListener('input',clear);
  root.addEventListener('change',event=>{if(event.target!==$('profitMonth'))clear();});
  $('profitMonth').value=new Date().toLocaleDateString('sv-SE').slice(0,7);
  $('profitMonth').addEventListener('change',()=>{clear();scheduleLoad();});
  $('profitAuditKey').addEventListener('change',renderAudit);
  $('profitReload').addEventListener('click',()=>run(load));
  $('profitAddCost').addEventListener('click',()=>{clear();addCost();});
  $('profitCostPreview').addEventListener('click',()=>run(async()=>preview(await workflow.preview('costs',costs()))));
  for(const [button,editor,key] of [['profitExpensePreview','profitExpenses','expenses'],['profitTaxPreview','profitTax','tax']]) $(button).addEventListener('click',()=>run(async()=>preview(await workflow.preview(key==='tax'?'tax:'+$('profitMonth').value:key,JSON.parse($(editor).value)))));
  $('profitMonthPreview').addEventListener('click',()=>run(async()=>{
    const current=generation,month=$('profitMonth').value,file=$('profitFile').files[0];
    let draft=monthDocument;
    if(file) {const form=new FormData();form.append('action','preview');form.append('month',month);form.append('report',file);const imported=await request(form);if(current!==generation)return;draft=imported.after;}
    if(!draft)throw new Error('Сначала выберите XLSX отчёт.');
    const recoveries=JSON.parse($('profitRecoveries')?.value?.trim() || '[]');if(!Array.isArray(recoveries))throw new Error('Подтверждения возвратов должны быть массивом JSON.');
    draft={...draft,quantityVerified:$('profitQuantity').checked,periodVerified:$('profitPeriod').checked,returnRecoveries:recoveries};
    $('profitReturnRows').textContent=json((draft.rows || []).filter(row=>row.service==='Возврат выручки'));
    const result=await workflow.preview('month:'+month,draft);if(current!==generation)return;
    monthDocument=draft;$('profitMonthDraft').textContent='Нормализовано строк: '+(draft.rows?.length ?? 'неизвестно')+'. Это черновик, сохранение только после подтверждения.';preview(result);
  }));
  $('profitConfirm').addEventListener('click',()=>run(async()=>{await workflow.confirm();message('Изменения сохранены.');await load();}));
  $('profitExpenseDraft').addEventListener('click',()=>{
    clear();const from=$('profitMonth').value+'-01';$('profitExpenses').value=json({items:[['waste','Мусор',900000,false],['leather-delivery','Доставка кожи',2000000,true],['remote-ilya-salary','Зарплата удалённого Ильи',2500000,false]].map(([id,label,amountKopecks,leatherDelivery])=>({id,label,amountKopecks,scope:'business',validFrom:from,validTo:null,leatherDelivery})),allocation:{method:'unallocated',shares:null,revenue:null,source:''}});message('Добавлен несохранённый черновик расходов. Мусор — 9 000 ₽/мес.; доставка кожи — 20 000 ₽/мес.; зарплата удалённого Ильи — 25 000 ₽/мес. Проверьте даты и источники перед сохранением.');
  });
  // Block the retired one-step save before the legacy handler can run.
  document.getElementById('ozonCostForm')?.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();location.hash='ozonProfit';message('Редактируйте себестоимость здесь: сначала предпросмотр, затем отдельное подтверждение.');},true);
  function enter(){clear();if(location.hash.split('/')[0]==='#ozonProfit')scheduleLoad();}
  window.addEventListener('hashchange',enter);window.addEventListener('pagehide',clear);enter();
})();
