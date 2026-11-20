(() => {
 const button=document.getElementById('wbFinanceCheckButton'),output=document.getElementById('wbFinanceCheckStatus');
 if(!button||!output)return;
 const endpoint='/api/wb/diagnostic',key='wb-finance-one-check-865265818-v1';
 let attempted=false;
 try{attempted=sessionStorage.getItem(key)==='sent'}catch{attempted=true}
 if(attempted){output.textContent='Попытка в этой сессии уже использована. Не повторяйте запрос; передайте результат проверки.';return}
 fetch(endpoint,{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>{if(r.ok&&(await r.json()).code==='owner_check_available')button.disabled=false;else output.textContent='Для проверки требуется вход владельца.'}).catch(()=>{output.textContent='Проверка доступа недоступна. Запрос к WB не отправлялся.'});
 button.addEventListener('click',async()=>{
  if(attempted)return;
  try{sessionStorage.setItem(key,'sent')}catch{output.textContent='Нельзя зафиксировать однократную попытку в браузере. Запрос не отправлен.';return}
  attempted=true;button.disabled=true;output.textContent='Один READ-ONLY запрос №865265818; без повторов и записи в D1…';
  try{
   const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-WB-Finance-Check':'865265818'},body:'{}'});
   const result=await r.json();
   if(result.code==='finance_report_received')output.textContent='WB HTTP '+result.upstreamHttp+'; операций '+result.operations+'; продажи '+result.sales+'; возвраты '+result.returns+'; выплата '+(Number(result.payoutKop)/100).toFixed(2)+' ₽; совпадение с XLSX: '+(result.comparison.payoutMatches&&result.comparison.salesMatch&&result.comparison.returnsMatch?'ДА':'НЕТ')+'. Запись D1: 0. Cron выключен.';
   else output.textContent='Проверка остановлена: '+result.code+'; HTTP WB '+(result.upstreamHttp??'не получен')+'. Автоповторов нет.';
  }catch{output.textContent='Результат запроса неизвестен. Не повторяйте попытку. Записи D1 нет.'}
 });
})();
