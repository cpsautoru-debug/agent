// UI projection only. Canonical financial calculations remain in business-pnl.
export function homeFinance(pnl){
 return {month:pnl?.month||null,profit:pnl?.verified===true&&Number.isSafeInteger(pnl.finalProfitKopecks)?pnl.finalProfitKopecks:null,channels:(pnl?.channels||[]).map(c=>({id:c.id,amount:Number.isSafeInteger(c.profitKopecks)?c.profitKopecks:null})),missing:(pnl?.channels||[]).filter(c=>c.status==='unknown').length};
}
if(typeof document!=='undefined'){
 const home=document.getElementById('officeHome'),finance=document.querySelector('[data-section="finance"]'),board=document.getElementById('ceoBoard');
 if(home&&finance&&board){
  finance.append(board);document.getElementById('officeFinanceSummary')?.remove();
  const controls=board.querySelector('.executive-controls');if(controls)home.querySelector('header').append(controls);
  for(const id of ['ceoOzonValue','ceoWbValue','ceoYandexValue','ceoOzonAuditValue']){const card=document.getElementById(id)?.closest('article');if(card)document.getElementById('officeHomeSources').append(card)}
  const names={ozon:'Ozon',wb:'Wildberries',yandex:'Яндекс Маркет'},links={ozon:'#ozonProfit',wb:'#wbFinance',yandex:'#yandexFinance'};
  const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):'Н/Д';
  function card(title,value,note,href){const a=document.createElement('a');a.className='office-kpi';a.href=href;for(const [tag,text]of [['span',title],['strong',value],['small',note]]){const e=document.createElement(tag);e.textContent=text;a.append(e)}return a}
  function render(pnl,management){
   const x=homeFinance(pnl),confirmed=x.profit!==null;
   const amount=confirmed?x.profit:management?.profitKopecks;
   const valid=Number.isSafeInteger(amount);
   const goal=50000000;
   const hero=card(confirmed?'Чистая прибыль':'Расчётная прибыль',valid?money(amount):'Н/Д',confirmed?'Источники подтверждены':valid?'Управленческий расчёт · финальная сверка не завершена':'Ожидаем полный управленческий расчёт','#finance');
   hero.classList.add('office-home-profit');
   const goalText=document.createElement('small');
   goalText.textContent='Цель: '+money(goal)+(valid?' · '+Math.round(amount/goal*100)+'%'+(confirmed?'':' (предварительно)'):'');
   hero.append(goalText);
   document.getElementById('officeHomeMetrics').replaceChildren(hero,
    card('Результат каналов',money(pnl?.knownChannelsTotalKopecks),pnl?String(pnl.knownChannelCount)+' из 3 каналов · до общих расходов и налога':'Ожидаем данные','#finance'),
    card('Общие расходы',money(pnl?.sharedExpenseTotalKopecks),pnl?.sharedExpensesComplete===true?'Подтверждено':'Известные расходы · полнота не подтверждена','#finance'),
    card('Налог',money(management?.taxKopecks),management?.taxHint||'Ожидаем данные','#finance'));
   document.getElementById('officeHomeChannels').replaceChildren(...['ozon','wb','yandex'].map(id=>card(names[id],money(x.channels.find(c=>c.id===id)?.amount),'После известных прямых затрат',links[id])));
   document.getElementById('officeHomeReconciliation').textContent=confirmed?'Период закрыт':pnl?'Финальная сверка не завершена':'Ожидаем источники';
  }
  window.addEventListener('ms:production-inventory-ready',event=>{const n=document.getElementById('officeHomeInventory'),d=event.detail;if(n)n.textContent=d&&Number.isSafeInteger(d.lowMeterRows)?d.lowMeterRows+' строк меньше 40 м · '+(d.complete?'обход завершён':'выборка неполная'):'Требуется проверка остатков'});
  const applyStockFilter=()=>{if(location.hash==='#warehouse/low'){const select=document.getElementById('msInventoryCategory');if(select){select.value='low';select.dispatchEvent(new Event('change',{bubbles:true}))}}};window.addEventListener('hashchange',applyStockFilter);applyStockFilter();
  const snapshot=document.getElementById('businessPnl')?.officePnlSnapshot;render(snapshot?.pnl||null,snapshot?.management);document.addEventListener('office:pnl-rendered',e=>render(e.detail.pnl,e.detail.management));
  document.getElementById('ceoMonth')?.addEventListener('change',()=>render(null));
 }
}
