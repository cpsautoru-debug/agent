(()=>{
  'use strict';
  const panel=document.getElementById('msProductionMonitor');
  const button=document.getElementById('msProductionRefresh');
  const status=document.getElementById('msProductionStatus');
  const count=document.getElementById('msProductionCount');
  const body=document.getElementById('msProductionRows');
  if(!panel||!button||!status||!count||!body)return;
  let loaded=false,loading=false;
  const safeDate=value=>{
    if(typeof value!=='string')return '—';
    const m=value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m?m[3]+'.'+m[2]+'.'+m[1]:'—';
  };
  const cell=(row,value)=>{
    const td=document.createElement('td');
    td.textContent=value;
    row.append(td);
  };
  async function refresh(){
    if(loading)return;
    loading=true;button.disabled=true;
    status.textContent='Получаем последние задания из «МойСклад»…';
    try{
      const response=await fetch('/api/ms/production-feed',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'}
      });
      const payload=await response.json();
      if(!response.ok||payload.code!=='ms_production_feed_ok'||!Array.isArray(payload.records))
        throw new Error(payload.code||'http_'+response.status);
      body.replaceChildren();
      for(const item of payload.records){
        const tr=document.createElement('tr');
        cell(tr,String(item.number??'—'));
        cell(tr,safeDate(item.date));
        cell(tr,safeDate(item.updated));
        body.append(tr);
      }
      count.textContent='В «МойСклад» всего заданий за всё время: '+payload.totalAllTime+
        '. Показаны последние '+payload.records.length+' по дате документа.';
      status.textContent='Данные получены напрямую через API. Только чтение.';
      loaded=true;
    }catch(error){
      status.textContent='Не удалось загрузить задания: '+String(error.message||'unknown').slice(0,70)+'. Проверьте сессию владельца.';
    }finally{
      loading=false;button.disabled=false;
    }
  }
  button.addEventListener('click',refresh);
  const onNavigation=()=>{if(location.hash.split('/')[0]==='#production'&&!loaded&&!loading)refresh();};
  window.addEventListener('hashchange',onNavigation);
  onNavigation();
})();