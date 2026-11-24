// Source catalogue for the single-window AutoSklad63 office.
// No API keys, no financial amounts, and no unverified metric aggregation here.
export const OFFICE_SOURCES=Object.freeze([
  {id:'moysklad',phase:1,title:'МойСклад · производство и 2 склада',section:'production',status:'partial',next:'Подтвердить живую очередь, этапы и фактические остатки'},
  {id:'msqueue',phase:1,title:'МойСклад · автоматическая очередь проверки',section:'production',status:'partial',next:'Проверить последний полный исторический снимок и очередь кандидатов; рабочие заказы отдельно'},
  {id:'ozon',phase:2,title:'Ozon · финансы и продажи',section:'ozonProfit',status:'partial',next:'Сверить начисления, возвраты, рекламу, налоги и банк'},
  {id:'wb',phase:2,title:'Wildberries · финансы и продажи',section:'wbFinance',status:'partial',next:'Устранить расхождения отчётов и подтвердить прибыль'},
  {id:'yandex',phase:2,title:'Яндекс Маркет · ИП Жилина Ольга',section:'yandexFinance',status:'partial',next:'Проверены отчёты и промежуточный доход; сверить COGS по SKU, возвраты, налог ИП и внешние расходы'},
  {id:'avito',phase:2,title:'Авито и офлайн-продажи',section:'connections',status:'planned',next:'Загрузка заказов и выручки с проверкой первичных документов'},
  {id:'inventory',phase:1,title:'Склад и закупки',section:'production',status:'partial',next:'Остатки двух складов, перемещения, отрицательные позиции и сигналы закупки'},
  {id:'agents',phase:3,title:'ИИ-агенты и поручения',section:'orchestrator',status:'partial',next:'Диспетчер, финансовый аналитик, аналитик продаж и журнал решений'},
  {id:'website',phase:3,title:'Сайт autosklad63.ru и SEO',section:'connections',status:'planned',next:'Безопасно подключить CMS, Метрику, заявки и конверсии'},
  {id:'social',phase:3,title:'Соцсети и реклама',section:'connections',status:'planned',next:'Метрики публикаций, охватов, заявок и эффективности без автопубликации'},
  {id:'ozonads',phase:2,title:'Ozon Performance API',section:'ozonProfit',status:'partial',next:'Сопоставить расходы с Finance и исключить двойные списания'}
]);
const allowed=new Set(['planned','partial','blocked','verified']);
export function createSourceRegistry(){
  const data=new Map(OFFICE_SOURCES.map(s=>[s.id,{...s,checkedAt:null,detail:''}]));
  return {
    update(id,{status,detail='',checkedAt=null}={}){
      if(!data.has(id)||!allowed.has(status))return false;
      if(typeof detail!=='string'||detail.length>180)return false;
      if(checkedAt!==null&&(!Number.isFinite(checkedAt)||checkedAt<0))return false;
      const current=data.get(id);
      data.set(id,{...current,status,detail,checkedAt});
      return true;
    },
    snapshot(){return [...data.values()].map(s=>({...s}));}
  };
}
const labels={planned:'В плане',partial:'В работе · не всё подтверждено',blocked:'Требует внимания',verified:'Подтверждено'};
export function renderSourceRegistry(target,sources){
  if(!target||typeof document==='undefined')return;
  target.replaceChildren();
  for(const s of sources){
    const item=document.createElement('article');
    item.className='ceo-source';
    const header=document.createElement('div');
    header.className='ceo-source-header';
    const name=document.createElement('strong');name.textContent=s.title;
    const badge=document.createElement('span');
    badge.className='ceo-state';
    badge.dataset.state=s.status==='verified'?'success':s.status==='blocked'?'danger':s.status==='partial'?'warning':'neutral';
    badge.textContent=labels[s.status]||'Нет данных';
    header.append(name,badge);
    const meta=document.createElement('p');
    meta.textContent='Этап '+s.phase+' · '+(s.detail||s.next);
    const link=document.createElement('a');
    link.href='#'+s.section;
    link.textContent='Открыть раздел';
    item.append(header,meta,link);
    target.append(item);
  }
}
