// Owner-only metadata view. Never allocates cross-boundary report amounts.
export function attachWbReportMonthBoundaries({
  documentRef=typeof document==='undefined'?null:document,
  windowRef=typeof window==='undefined'?null:window,
  fetchSource=typeof fetch==='undefined'?null:fetch
}={}){
  const el=id=>documentRef?.getElementById(id);
  const form=el('wbMonthBoundaryForm'),input=el('wbMonthBoundaryMonth');
  const status=el('wbMonthBoundaryStatus'),rows=el('wbMonthBoundaryRows');
  if(!form||!input||!status||!rows||!windowRef||!fetchSource)return false;
  const previous=new Date();
  previous.setUTCDate(1);previous.setUTCMonth(previous.getUTCMonth()-1);
  input.value=previous.toISOString().slice(0,7);
  let busy=false;
  const rub=kop=>new Intl.NumberFormat('ru-RU',{
    style:'currency',currency:'RUB'
  }).format(kop/100);
  const cell=(row,value)=>{
    const node=documentRef.createElement('td');
    node.textContent=String(value);row.append(node);
  };
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    busy=true;rows.replaceChildren();
    status.textContent='Читаем даты отчётов WB без изменения данных…';
    try{
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.value))
        throw Error('invalid_period');
      const response=await fetchSource('/api/wb/report-month-boundaries?month='+
        encodeURIComponent(input.value),{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)
      });
      if(!response.ok)throw Error('source_unavailable');
      const data=await response.json();
      if(data?.code!=='wb_report_month_boundary_audit'||
        data.month!==input.value||data.readOnly!==true||
        data.changedRecords!==0||
        data.scope!=='REPORT_PERIOD_METADATA_NOT_TRANSACTION_DATES'||
        data.calendarMonthComplete!==false||
        data.bankStatementVerified!==false||
        data.monthAttributionVerified!==false||
        data.netProfitKopecks!==null||
        !Array.isArray(data.whollyInside)||
        !Array.isArray(data.crossing)||!Array.isArray(data.pending)||
        !Number.isSafeInteger(data.totalWhollyInsideKopecks))
        throw Error('invalid_source');
      for(const [kind,items] of [
        ['Внутри месяца',data.whollyInside],
        ['Переходит через границу месяца',data.crossing],
        ['Не завершён',data.pending]
      ]){
        for(const item of items.slice(0,2000)){
          const tr=documentRef.createElement('tr');
          for(const v of [item.reportId,item.from+' — '+item.to,
            kind,rub(item.payoutKopecks)])cell(tr,v);
          rows.append(tr);
        }
      }
      status.textContent='Внутри месяца: '+data.whollyInside.length+
        ', переходящих: '+data.crossing.length+
        ', не завершённых: '+data.pending.length+
        '. Сумма только отчётов полностью внутри месяца: '+
        rub(data.totalWhollyInsideKopecks)+
        '. Это НЕ сумма выплат за месяц и НЕ чистая прибыль. '+
        'Переходящие отчёты нельзя делить по месяцам без дат отдельных операций.';
    }catch{
      status.textContent='Не удалось проверить границы отчётного месяца WB. Данные не менялись; месячная сумма не подтверждена.';
    }finally{busy=false;}
  });
  return true;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')
  attachWbReportMonthBoundaries();
