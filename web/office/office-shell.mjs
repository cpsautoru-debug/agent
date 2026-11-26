export const sectionForRoute=route=>{
 if(['dashboard','overview'].includes(route))return 'dashboard';
 if(['finance','ozonProfit','ozonFinance','wbFinance','yandexFinance'].includes(route))return 'finance';
 if(['agents','departments','workflow','studio','connections'].includes(route))return 'agents';
 return ['orders','production','warehouse','orchestrator'].includes(route)?route:'dashboard';
};
export const financeTabForRoute=route=>({ozonProfit:'ozon',ozonFinance:'ozon',wbFinance:'wb',yandexFinance:'yandex'}[route]||'summary');
if(typeof document!=='undefined'){
 const routes=[['finance','Общая картина'],['ozonProfit','Ozon'],['wbFinance','Wildberries'],['yandexFinance','Яндекс Маркет']];
 const team=[['agents','Сотрудники и агенты'],['departments','Отделы'],['studio','Контент'],['connections','Подключения'],['workflow','Процесс заказа']];
 const addTabs=(node,items,label)=>{
  if(!node)return;const nav=document.createElement('nav');nav.className='office-tabs';nav.setAttribute('aria-label',label);
  for(const [hash,title]of items){const a=document.createElement('a');a.href='#'+hash;a.textContent=title;a.dataset.officeTab=hash;nav.append(a)}node.prepend(nav);
 };
 for(const [route]of routes)addTabs(document.querySelector('[data-section="'+route+'"]'),routes,'Финансы: разделы');
 addTabs(document.querySelector('[data-section="ozonFinance"]'),routes,'Финансы: разделы');
 for(const [route]of team)addTabs(document.querySelector('[data-section="'+route+'"]'),team,'Команда: разделы');
 const inventory=document.getElementById('msInventoryControl'),warehouse=document.querySelector('[data-section="warehouse"]');
 if(inventory&&warehouse)warehouse.append(inventory);
 const home=document.querySelector('[data-section="dashboard"]'),overview=document.querySelector('[data-section="overview"]');
 if(home&&overview){const detail=document.createElement('details');detail.className='office-legacy-overview';const title=document.createElement('summary');title.textContent='Карта офиса и быстрые ссылки';detail.append(title,overview);home.append(detail)}
 function navigate(){
  const route=location.hash.slice(1).split('/')[0]||'dashboard',group=sectionForRoute(route);
  const exact=document.querySelector('[data-section="'+CSS.escape(route)+'"]');
  const target=route==='overview'?home:exact||home;
  document.querySelectorAll('[data-section]').forEach(s=>s.hidden=s!==target&&!(s===overview&&target===home));
  document.querySelectorAll('.sidebar nav [data-page]').forEach(a=>{const active=a.dataset.page===group;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  document.querySelectorAll('[data-office-tab]').forEach(a=>{const active=group==='finance'?financeTabForRoute(a.dataset.officeTab)===financeTabForRoute(route):a.dataset.officeTab===route;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  const title={dashboard:'Главная',orders:'Заказы',production:'Производство',finance:'Финансы',warehouse:'Склад',agents:'Команда',orchestrator:'Служебная страница'}[group];
  const breadcrumb=document.getElementById('breadcrumb');if(breadcrumb)breadcrumb.textContent=title;
  document.title=title+' · АвтоСклад63';
 }
 window.addEventListener('hashchange',navigate);
 document.addEventListener('DOMContentLoaded',navigate);navigate();
}
