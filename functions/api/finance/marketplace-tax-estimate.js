import {calculateProfit} from '../ozon/profit-model.js';
import {readWbRetailListSource} from './wb-retail-list-source.js';
import {yandexDeliveryGrossScenario} from '../../../web/office/yandex-tax-delivery-scenario.mjs';
import {onRequestGet as auditYandexArchive} from '../yandex/report-audit.js';
import {verifySession} from '../auth/session.js';
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const out=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const OWNER="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const safe=n=>Number.isSafeInteger(n);
function roundRate(kopecks,bps){if(!safe(kopecks)||kopecks<0)throw Error('invalid_income');return Number((BigInt(kopecks)*BigInt(bps)+5000n)/10000n);}
export async function onRequestGet({request,env}){
 if(request.method!=='GET')return out(405,{code:'method_not_allowed'});
 const url=new URL(request.url),month=url.searchParams.get('month');
 if(url.pathname!=='/api/finance/marketplace-tax-estimate'||url.searchParams.size!==1||
    !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))return out(400,{code:'invalid_month'});
 if(!env?.OZON_FINANCE_DB||!env.OFFICE_SESSION_SECRET||
    !env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_SYNC||
    !env.WB_REPORT_SNAPSHOT_DB||!env.WB_REPORT_ACCOUNT_ID)
   return out(503,{code:'source_not_configured'});
 try{
  const user=await verifySession(request,env.OFFICE_SESSION_SECRET);
  if(!user)return out(401,{code:'unauthorized'});
  const yes=await env.OZON_FINANCE_DB.prepare(OWNER)
   .bind(user,env.OFFICE_ALLOWED_EMAIL).first();
  if(yes?.allowed!==1)return out(403,{code:'forbidden'});
  // WB official retail amounts are a separate, cached source scenario.
  // Run alongside Ozon and Yandex reads; never replace the payout audit.
  const wbRetailJob=readWbRetailListSource(env,month);
  const profit=await env.OZON_FINANCE_SYNC.getProfitDocument('month:'+month);
  const confirmedMonth=profit?.key==='month:'+month&&
   profit?.target==='ce9dd331-929d-4c3e-9073-368de3346bc9'&&
   profit.value?.quantityVerified===true&&profit.value?.periodVerified===true&&
   Array.isArray(profit.value?.rows);
  let ozon={status:'missing_monthly_source',taxRateBps:800,incomeKopecks:null,
   taxEstimateKopecks:null,verifiedByFNS:false};
  if(confirmedMonth){
   let income=0,sales=0,refunds=0;
   for(const row of profit.value.rows){
    if(!safe(row.amountKopecks))throw Error('invalid_ozon_amount');
    if(row.service==='Выручка'){income+=row.amountKopecks;sales++;}
    else if(row.service==='Возврат выручки'){income+=row.amountKopecks;refunds++;}
    if(!safe(income))throw Error('sum_overflow');
   }
   ozon={status:'estimate_sales_less_returns_only',taxRateBps:800,
    salesRows:sales,returnRows:refunds,incomeKopecks:income,
    taxEstimateKopecks:income>=0?roundRate(income,800):null,
    verifiedByFNS:false,
    exclusions:['marketplace_points_and_bonus_classification',
     'tax_recognition_date','other_channels_same_taxpayer']};
  }
  // A management estimate after tax is shown only if the canonical
  // finance API agrees with the official XLSX AND dated product cost is complete.
  if(ozon.taxEstimateKopecks!==null&&
     typeof env.OZON_FINANCE_SYNC.getProfitData==='function'){
   try{
   const canonical=await env.OZON_FINANCE_SYNC.getProfitData(month);
   if(canonical?.target==='ce9dd331-929d-4c3e-9073-368de3346bc9'&&
      canonical.configuration?.month?.sourceSha256===profit.value?.sourceSha256){
    const result=calculateProfit({month,api:canonical.api,
     documents:canonical.configuration.month,costs:canonical.configuration.costs,
     expenses:canonical.configuration.expenses,tax:canonical.configuration.tax});
    const matched=result.report?.totalKopecks===result.api?.totalKopecks&&
     result.dateCostEvidence?.complete===true&&result.costs?.complete===true;
    if(matched){
     const x=result.api.totalKopecks-result.costs.knownKopecks-
      ozon.taxEstimateKopecks;
     if(safe(x))ozon.managementAfterTaxBeforeOverheadKopecks=x;
    }
   }
   }catch{/* A missing contribution must not suppress a valid tax estimate. */}
  }
  const bounds=month+'-01';
  const wbR=await env.WB_REPORT_SNAPSHOT_DB.prepare(
   "SELECT COUNT(*) n,SUM(CAST(json_extract(snapshot_json,'$.preview.estimate.taxKop') AS INTEGER)) tax, "+
   "SUM(CASE WHEN json_extract(snapshot_json,'$.preview.estimate.taxBasisStatus')='ASSUMED' THEN 1 ELSE 0 END) assumed "+
   "FROM wb_saved_xlsx_reports WHERE account_id=? AND json_extract(snapshot_json,'$.periodStart')>=? "+
   "AND json_extract(snapshot_json,'$.periodEnd')<date(?,'+1 month')"
  ).bind(env.WB_REPORT_ACCOUNT_ID,bounds,bounds).first();
  const wbApi=await env.WB_REPORT_SNAPSHOT_DB.prepare(
   "SELECT COUNT(*) n FROM wb_finance_api_reports WHERE account_id=? AND date_from>=? "+
   "AND date_to<date(?,'+1 month') AND status='complete'"
  ).bind(env.WB_REPORT_ACCOUNT_ID,bounds,bounds).first();
  const saved=Number(wbR?.n??0),available=Number(wbApi?.n??0);
  const amount=wbR?.tax;
  const wb={status:saved>0?'partial_manual_xlsx_tax_estimates':'no_tax_source',
   taxRateBps:800,savedReports:saved,apiReports:available,
   // Report count parity is not evidence of a reconciled taxable base.
   // ASSUMED/MANUAL_ESTIMATE snapshots can never close this gate.
   reportCoverageComplete:saved===available&&saved>0,
   complete:false,
   taxBaseComplete:false,
   savedTaxEstimateKopecks:safe(amount)&&amount>=0?amount:null,
   taxableGrossSalesKopecks:null,
   verifiedByFNS:false,
   note:'Saved WB report tax estimates are ASSUMED. A WB payout / for_pay is not gross taxable revenue.'};
  // A scenario on EXACTLY the delivered orders, not the 79 mixed-status
  // order rows. AУСН cash-recognition dates and compensations still require
  // separate treatment; this is management evidence, not final FNS tax.
  let yandex={status:'delivered_order_tax_source_unavailable',taxRateBps:800,
   grossOrderValueKopecks:null,incomeKopecks:null,
   taxEstimateKopecks:null,verifiedByFNS:false};
  try{
   const jobs=await env.OZON_FINANCE_DB.prepare(
    "SELECT scope,report_type,report_id FROM yandex_finance_report_jobs "+
    "WHERE month=? AND status='DONE' AND "+
    "((scope='all' AND report_type='orders') OR "+
    "(scope='149082506' AND report_type='realization')) LIMIT 4"
   ).bind(month).all();
   const row=jobs.results||[];
   const pick=(scope,type)=>row.filter(x=>x.scope===scope&&
    x.report_type===type&&/^[a-zA-Z0-9_-]{1,255}$/.test(x.report_id||''));
   const o=pick('all','orders'),d=pick('149082506','realization');
   if(o.length===1&&d.length===1){
    const fetchReport=async reportId=>{
     const target=new URL('/api/yandex/report-audit',url.origin);
     target.searchParams.set('reportId',reportId);
     const reply=await auditYandexArchive({request:new Request(target,{
      method:'GET',headers:request.headers}),env});
     if(!reply.ok)return null;
     const data=await reply.json();
     return data?.code==='yandex_report_archive_audited'&&
      data.readOnly===true&&data.changedRecords===0&&
      data.financeProfitVerified===false&&
      Array.isArray(data.sheets)?data:null;
    };
    const [ordersReport,deliveryReport]=await Promise.all([
     fetchReport(o[0].report_id),fetchReport(d[0].report_id)
    ]);
    if(ordersReport&&deliveryReport){
     const verified=yandexDeliveryGrossScenario(month,
      ordersReport,deliveryReport);
     if(verified){
      yandex={status:verified.status,taxRateBps:800,
       grossOrderValueKopecks:verified.grossKopecks,
       incomeKopecks:null,taxEstimateKopecks:verified.taxScenarioKopecks,
       orderRows:verified.deliveredOrders,
       deliveredUnits:verified.deliveredUnits,
       excludedNonDeliveryOrderRows:verified.excludedOrderRows,
       verifiedByFNS:false,
       exclusions:['tax_cash_recognition_dates',
        'marketplace_discount_compensations',
        'cash_receipt_and_offset_reconciliation',
        'separate_returns_and_other_ip_income']};
     }else yandex.status='delivery_order_join_incomplete';
    }else yandex.status='delivery_or_order_archive_unavailable';
   }else yandex.status='delivery_or_order_archive_missing';
  }catch{yandex.status='official_delivery_order_read_unavailable';}

  const wbRetail=await wbRetailJob;
  wb.retailReportAudit={status:wbRetail.status,
   source:wbRetail.source??null,
   reports:wbRetail.savedReports??null,
   grossRetailKopecks:wbRetail.retailGrossKopecks,
   grossRetailTaxScenarioKopecks:wbRetail.retailTaxScenarioKopecks,
   verifiedTaxBase:false,
   caveat:'WB report retail sales are NOT yet adjusted for confirmed tax-date returns and settlement.'};
  return out(200,{code:'marketplace_tax_management_estimate',month,readOnly:true,
   changedRecords:0,entityOzonWb:'ИП Жилина',entityYandex:'ИП Жилина',
   ozon,wb,yandex,
   totalTaxKopecks:null,officialTaxVerified:false,
   note:'These are management estimates. Marketplace commissions are not subtracted from taxable gross income. No amount is treated as official tax.'});
 }catch{return out(503,{code:'marketplace_tax_sources_unavailable'});}
}
