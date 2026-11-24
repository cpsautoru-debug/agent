// Owner-controlled read-only connection test. This never exposes an API key.
export function attachYandexMarketConnection({documentRef=document,fetcher=fetch}={}){
 const button=documentRef.getElementById('yandexConnectionCheck');
 const status=documentRef.getElementById('yandexConnectionStatus');
 if(!button||!status)return false;
 let working=false;
 async function check(){
  if(working)return;
  working=true;button.disabled=true;
  status.textContent='Проверяем подключение Яндекс Маркета и доступ к финансовой отчётности…';
  try{
   const r=await fetcher('/api/yandex/connection-status',{
    method:'GET',credentials:'same-origin',cache:'no-store',
    signal:AbortSignal.timeout(16000)});
   if(!r.ok)throw Error('unavailable');
   const data=await r.json();
   if(data.code==='yandex_secret_missing')
    status.textContent='Ожидается секрет Cloudflare: YANDEX_MARKET_API_KEY. Токен в чат не отправлять.';
   else if(data.code==='yandex_finance_access_confirmed'&&data.connected===true)
    status.textContent='Токен Яндекс Маркета работает, финансовые права подтверждены.'+
      (data.readOnlyToken===false?
       ' Внимание: у токена есть право изменения данных; рекомендуется заменить на токен только для просмотра.':'')+
      ' Прибыль не рассчитана: загрузка и сверка финансовых операций ещё не выполнены.';
   else if(data.code==='yandex_finance_access_missing')
    status.textContent='Токен работает, но не имеет доступа к финансовой отчётности.';
   else status.textContent='Подключение пока не подтверждено: '+(
     /^[a-z_]{3,60}$/.test(data.code||'')?data.code:'источник недоступен')+'.';
  }catch{status.textContent='Проверка Яндекс Маркета временно недоступна.';}
  finally{working=false;button.disabled=false;}
 }
 button.addEventListener('click',check);
 // Recheck only when the management dashboard is visible. This is a
 // read-only owner-gated request; token never enters browser JavaScript.
 let seen=false;
 const onVisible=()=>{
  if(location.hash.split('/')[0]==='#yandexFinance'&&!seen){
   seen=true;void check();
  }
 };
 window.addEventListener('hashchange',onVisible);
 onVisible();
 return true;
}
if(typeof document!=='undefined')attachYandexMarketConnection();
