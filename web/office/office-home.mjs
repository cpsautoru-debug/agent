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
  const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):'Нет подтверждения';
  function card(title,value,note,href){const a=document.createElement('a');a.className='office-kpi';a.href=href;for(const [tag,text]of [['span',title],['strong',value],['small',note]]){const e=document.createElement(tag);e.textContent=text;a.append(e)}return a}
  function render(pnl){const x=homeFinance(pnl);document.getElementById('officeHomeMetrics').replaceChildren(
   card('Выручка','Нет полной сверки','Общая выручка трёх каналов не подтверждена','#finance'),
   card('Подтверждённая чистая прибыль',money(x.profit),x.profit===null?'Расчётная прибыль отдельно в финансах':'Все источники подтверждены','#finance'),
   card('Заказы за период','Нет подтверждения','Полный состав заказов за месяц не установлен','#orders'),
   card('Требуют решения',pnl?String(x.missing)+' каналов':'Ожидаем данные','Только неполные финансовые источники; не все проблемы офиса','#finance'));
   document.getElementById('officeHomeChannels').replaceChildren(...['ozon','wb','yandex'].map(id=>card(names[id],money(x.channels.find(c=>c.id===id)?.amount),'После прямых затрат',links[id])));
   document.getElementById('officeHomeReconciliation').textContent=pnl?'Не закрыто каналов: '+x.missing+' · налог и общие расходы проверяются отдельно':'Ожидаем источники';
  }
  render(null);document.addEventListener('office:pnl-rendered',e=>render(e.detail.pnl));
  document.getElementById('ceoMonth')?.addEventListener('change',()=>render(null));
 }
}
