// This view selects canonical amounts. It never sums settlement, costs or tax again.
export function financeOverview(pnl){return [
 {label:'Выручка',amount:null,note:'Общая валовая выручка трёх каналов не сверена'},
 {label:'Расходы маркетплейсов',amount:null,note:'Уже учтены в результатах каналов; полная отдельная сумма не подтверждена'},
 {label:'Себестоимость',amount:null,note:'Смотрите проверенные составы затрат по каналам'},
 {label:'Налоги · подтверждённые',amount:pnl?.taxesComplete===true?pnl.taxTotalKopecks:null,note:'Управленческая оценка АУСН показана отдельно ниже'},
 {label:'Дополнительные расходы',amount:pnl?.sharedExpenseTotalKopecks??null,note:pnl?.sharedExpensesComplete===true?'Полнота регистра подтверждена':'Известный регистр; полнота расходов не подтверждена'},
 {label:'Подтверждённая чистая прибыль',amount:pnl?.verified===true?pnl.finalProfitKopecks:null,note:pnl?.verified===true?'Источники закрыты':'Расчётный результат ниже не является подтверждённой чистой прибылью'}
 ];}
if(typeof document!=='undefined'){
 const root=document.getElementById('officeFinanceMetrics');if(root){
  const period=document.getElementById('officeFinanceMonth'),canonical=document.getElementById('ceoMonth');
  const sync=()=>{period.value=canonical.value};sync();
  const render=pnl=>{root.replaceChildren(...financeOverview(pnl).map(x=>{const a=document.createElement('article');a.className='office-kpi';for(const [tag,text]of [['span',x.label],['strong',Number.isSafeInteger(x.amount)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(x.amount/100):'Нет подтверждения'],['small',x.note]]){const el=document.createElement(tag);el.textContent=text;a.append(el)}return a}))};
  render(null);document.addEventListener('office:pnl-rendered',e=>{sync();render(e.detail.pnl)});
  canonical.addEventListener('change',()=>{sync();render(null)});period.addEventListener('change',()=>{canonical.value=period.value;canonical.dispatchEvent(new Event('change',{bubbles:true}))});
  document.getElementById('officeFinanceRefresh').addEventListener('click',()=>{render(null);document.getElementById('businessPnlRefresh').click()});
  const h=document.querySelector('#ceoBoard h1');if(h){const title=document.createElement('h2');title.textContent='Управленческий расчёт · после известных затрат';h.replaceWith(title)}
  const ozon=document.querySelector('[data-section="ozonProfit"]');if(ozon){const a=document.createElement('a');a.className='button light';a.href='#ozonFinance';a.textContent='Источники и сверка начислений Ozon';ozon.querySelector('.office-tabs')?.after(a)}
 }
}
