// Owner-only read of custom order states. NEVER infer dispatch eligibility.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const root=el('msOrderStates'),msg=el('msOrderStatesMessage');
  const list=el('msOrderStatesResults'),button=el('msOrderStatesRefresh');
  if(!root||!msg||!list||!button)return;
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const active=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  let busy=false,lastCheck=0;
  const valid=data=>data?.code==='ms_order_status_catalog_ok'&&
    data.readOnly===true&&data.changedRecords===0&&
    data.approvedForDispatch===false&&
    data.source==='MOYSKLAD_CUSTOMER_ORDER_METADATA'&&
    data.interpretation==='UNMAPPED_SOURCE_STATES_NOT_ACTIVE_ORDER_CLASSIFICATION'&&
    Number.isSafeInteger(data.count)&&data.count>=0&&data.count<=100&&
    Array.isArray(data.states)&&data.states.length===data.count&&
    data.states.every(s=>UUID.test(s?.id)&&typeof s.name==='string'&&
      s.name.length>0&&s.name.length<=100)&&
    new Set(data.states.map(s=>s.id.toLowerCase())).size===data.count;
  async function load(){
    if(busy||!active())return;
    busy=true;lastCheck=Date.now();button.disabled=true;
    list.hidden=true;list.replaceChildren();
    msg.textContent='Читаем справочник статусов из «МойСклад»…';
    try{
      const response=await fetch('/api/ms/customer-order-status-catalog',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
      if(!response.ok)throw Error('unavailable');
      const data=await response.json();
      if(!valid(data))throw Error('schema');
      for(const state of data.states){
        const span=document.createElement('span');
        span.textContent=state.name;
        list.append(span);
      }
      list.hidden=data.count===0;
      msg.textContent=data.count?
        'Справочник успешно прочитан: '+data.count+
        ' статусов. Их соответствие рабочим и закрытым заказам ещё не утверждено.':
        'В «МойСклад» не обнаружены статусы заказов. Классификация не готова.';
    }catch{
      msg.textContent='Справочник статусов сейчас недоступен. '+
        'Автоматическое определение действующих заказов остаётся отключённым.';
    }finally{busy=false;button.disabled=false;}
  }
  const maybe=()=>{if(active()&&!busy&&Date.now()-lastCheck>10*60*1000)void load();};
  button.addEventListener('click',load);
  window.addEventListener('hashchange',maybe);
  document.addEventListener('visibilitychange',maybe);
  maybe();
})();
