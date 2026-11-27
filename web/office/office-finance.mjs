// This view selects canonical amounts. It never sums settlement, costs or tax again.
export function financeOverview(pnl,management){
 const verified=pnl?.verified===true;
 return [
 {label:verified?'Чистая прибыль':'Расчётная прибыль',amount:verified?pnl.finalProfitKopecks:management?.profitKopecks??null,note:verified?'Источники закрыты':'Управленческий итог; не окончательное закрытие'},
 {label:'Результат маркетплейсов',amount:pnl?.knownChannelsTotalKopecks??null,note:pnl?(pnl.knownChannelCount+' из 3 каналов · до общих расходов и налога'):'Ожидаем данные'},
 {label:'Дополнительные расходы',amount:pnl?.sharedExpenseTotalKopecks??null,note:pnl?.sharedExpensesComplete===true?'Полнота регистра подтверждена':'Известный регистр; полнота расходов не подтверждена'},
 {label:'АУСН в расчёте',amount:management?.taxKopecks??null,note:management?.taxHint||'Источник не подтверждён'}
 ];
}
if(typeof document!=='undefined'){
 const root=document.getElementById('officeFinanceMetrics');if(root){
  const period=document.getElementById('officeFinanceMonth'),canonical=document.getElementById('ceoMonth');
  const sync=()=>{period.value=canonical.value};sync();
  const render=(pnl,management)=>{root.replaceChildren(...financeOverview(pnl,management).map(x=>{const a=document.createElement('article');a.className='office-kpi';for(const [tag,text]of [['span',x.label],['strong',Number.isSafeInteger(x.amount)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(x.amount/100):'Нет подтверждения'],['small',x.note]]){const el=document.createElement(tag);el.textContent=text;a.append(el)}return a}))};
  const snapshot=document.getElementById('businessPnl')?.officePnlSnapshot;render(snapshot?.pnl||null,snapshot?.management);document.addEventListener('office:pnl-rendered',e=>{sync();render(e.detail.pnl,e.detail.management)});
  canonical.addEventListener('change',()=>{sync();render(null)});period.addEventListener('change',()=>{canonical.value=period.value;canonical.dispatchEvent(new Event('change',{bubbles:true}))});
  document.getElementById('officeFinanceRefresh').addEventListener('click',()=>{render(null);document.getElementById('businessPnlRefresh').click()});
  const h=document.querySelector('#ceoBoard h1');if(h){const title=document.createElement('h2');title.textContent='Управленческий расчёт · после известных затрат';h.replaceWith(title)}
  const ozon=document.querySelector('[data-section="ozonProfit"]');if(ozon){const a=document.createElement('a');a.className='button light';a.href='#ozonFinance';a.textContent='Источники и сверка начислений Ozon';ozon.querySelector('.office-tabs')?.after(a)}
 }
}
