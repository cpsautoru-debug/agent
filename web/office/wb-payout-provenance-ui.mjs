import {explainWbPayoutEvidence} from './wb-payout-provenance-core.mjs';
// Strictly read-only WB evidence; does not imply independent bank receipt.
export function attachWbPayoutEvidence({
  documentRef=typeof document==='undefined'?null:document,
  windowRef=typeof window==='undefined'?null:window,
  fetchSource=typeof fetch==='undefined'?null:fetch
}={}){
  const root=documentRef?.getElementById('financeWbPayoutEvidence');
  const refresh=documentRef?.getElementById('financeWbPayoutEvidenceRefresh');
  const status=documentRef?.getElementById('financeWbPayoutEvidenceStatus');
  if(!root||!refresh||!status||!windowRef||!fetchSource)return false;
  let busy=false;
  const visible=()=>windowRef.location?.hash?.split('/')[0]==='#wbFinance'&&
    documentRef.visibilityState!=='hidden';
  async function load(){
    if(busy||!visible())return;
    busy=true;refresh.disabled=true;
    status.textContent='Читаем завершённые финансовые отчёты WB…';
    try{
      const res=await fetchSource('/api/wb/unit-economics',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)
      });
      if(!res.ok)throw Error('source_unavailable');
      const result=explainWbPayoutEvidence(await res.json());
      const amount=new Intl.NumberFormat('ru-RU',{
        style:'currency',currency:'RUB'
      }).format(result.reportedPayoutKopecks/100);
      status.textContent=result.label+'. Завершено отчётов: '+
        result.reportCount+', операций: '+result.operationCount+
        ', в обработке: '+result.pendingCount+
        '. Выплата по отчётам: '+amount+'. '+result.note;
    }catch{
      status.textContent='Невозможно подтвердить внутреннюю сверку WB по текущему источнику. Это не означает нулевую выплату или чистую прибыль.';
    }finally{busy=false;refresh.disabled=false;}
  }
  refresh.addEventListener('click',load);
  windowRef.addEventListener('hashchange',()=>{if(visible())void load();});
  if(visible())void load();
  return true;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')
  attachWbPayoutEvidence();
