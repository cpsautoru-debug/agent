// Owner-facing tax planning, not FNS declaration or final net profit.
const money=x=>Number.isSafeInteger(x)?new Intl.NumberFormat('ru-RU',
 {style:'currency',currency:'RUB'}).format(x/100):'Нет данных';
const node=(tag,value)=>{const n=document.createElement(tag);
 if(value!==undefined)n.textContent=value;return n;};
export function attachMarketplaceTaxEstimate(){
 const panel=document.querySelector('[data-section="ozonProfit"]');
 const monthInput=document.getElementById('profitMonth');
 if(!panel||!monthInput)return false;
 const box=node('article');box.className='profit-panel';
 const head=node('h3','Налог по отчётам маркетплейсов · управленческая оценка');
 const status=node('p','Налог рассчитывается по подтверждённым источникам; без налоговых выписок.');
 status.setAttribute('role','status');
 const list=node('div');
 const note=node('p','Комиссии и услуги маркетплейсов НЕ уменьшают базу налога «доходы». '+
  'Оценка не является начислением ФНС; доход учитывается по правилам налогового периода, '+
  'включая взаимозачёты и возможные бонусы.');
 box.append(head,status,list,note);
 const anchor=document.getElementById('profitCloseoutChecklist');
 if(anchor?.parentNode)anchor.after(box);else panel.prepend(box);
 let busy=false,loaded=null;
 async function load(){
  const month=monthInput.value;if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||busy)return;
  busy=true;status.textContent='Получаем налоговую оценку '+month+'…';
  try{
   const r=await fetch('/api/finance/marketplace-tax-estimate?month='+encodeURIComponent(month),
    {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('unavailable');
   const v=await r.json();
   if(v.code!=='marketplace_tax_management_estimate'||v.month!==month||
     v.officialTaxVerified!==false||v.totalTaxKopecks!==null)throw Error('invalid_response');
   list.replaceChildren();
   const rows=[
    ['Ozon · ИП · АУСН 8%',
     money(v.ozon?.taxEstimateKopecks),
     'База по выручке и возвратам: '+money(v.ozon?.incomeKopecks)+'. '+
     'Бонусы и дата признания дохода ещё требуют классификации.'],
    ['Wildberries · ИП · АУСН 8%',
     money(v.wb?.savedTaxEstimateKopecks),
     'Предварительная сумма только по '+(v.wb?.savedReports??0)+
     ' из '+(v.wb?.apiReports??0)+' сохранённых отчётов. Не полная база.'],
    ['Яндекс Маркет · ООО · УСН 6%',
     money(v.yandex?.taxEstimateKopecks),
     'Оба магазина относятся к ООО. До подтверждения валового дохода сумма не вычисляется.']
   ];
   for(const [label,amount,desc] of rows){
    const section=node('section');
    const h=node('strong',label+' — '+amount);
    const p=node('p',desc);
    section.append(h,p);list.append(section);
   }
   status.textContent='Источники прочитаны за '+month+
    '. Налог по всем каналам и чистая прибыль не подтверждены.';
   loaded=month;
  }catch{
   status.textContent='Сервис налоговой оценки пока недоступен; подставлять 0 ₽ запрещено.';
  }finally{busy=false;}
 }
 function activate(){
  if(location.hash.split('/')[0]==='#ozonProfit'&&loaded!==monthInput.value)void load();
 }
 window.addEventListener('hashchange',activate);
 monthInput.addEventListener('change',()=>{loaded=null;activate();});
 queueMicrotask(activate);
 return true;
}
if(typeof document!=='undefined')attachMarketplaceTaxEstimate();
