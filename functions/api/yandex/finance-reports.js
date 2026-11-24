import {headers,json,verifyYandexOwner,yandexRequest,
 listYandexCampaigns,selectedBusiness,monthBounds,
 reportPaths,mapSafeYandexError} from './finance-source.js';
const allowedReports=new Set(Object.keys(reportPaths));
const key=/^[a-zA-Z0-9_-]{1,255}$/;
export async function onRequestGet({request,env}){
 if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
 const url=new URL(request.url);
 if(url.pathname!=='/api/yandex/finance-reports')return json(404,{code:'not_found'});
 const issue=await verifyYandexOwner(request,env);
 if(issue)return json(issue.status,{code:issue.code});
 const action=url.searchParams.get('action');
 if(action==='discover'&&url.searchParams.size===1){
  try{
   const campaigns=await listYandexCampaigns(env);
   const grouped=[...new Map(campaigns.map(c=>[c.businessId,
    {businessId:c.businessId,businessName:c.businessName}])).values()];
   const oneLegalEntity=grouped.length===1&&campaigns.length===2&&
     [149082506,149106500].every(id=>campaigns.some(c=>c.campaignId===id));
   return json(200,{code:'yandex_campaigns_discovered',
    readOnly:true,changedRecords:0,campaigns,businesses:grouped,
    automaticScope:grouped.length===1?'single_business':'selection_required',
    ownerConfirmedSingleOoo:oneLegalEntity,
    scopeRule:'Each shop individually or both shops together, never sum their joint report again',
    financeProfitKopecks:null,verifiedProfit:false});
  }catch(e){return json(503,{code:mapSafeYandexError(e)});}
 }
 if(action==='status'&&url.searchParams.size===2){
  const reportId=url.searchParams.get('reportId');
  if(!key.test(reportId||''))return json(400,{code:'invalid_report_id'});
  try{
   const result=await yandexRequest(env,
     '/v2/reports/info/'+reportId);
   const status=result.result?.status;
   if(!['PENDING','PROCESSING','DONE','FAILED'].includes(status))
    throw Error('yandex_report_response_invalid');
   // Never return time-limited signed file links to client, logs or referrers.
   return json(200,{code:'yandex_report_status',status,
    subStatus:['NO_DATA','TOO_LARGE','RESOURCE_NOT_FOUND'].includes(
       result.result?.subStatus)?result.result.subStatus:null,
    fileAvailable:status==='DONE'&&typeof result.result.file==='string'&&
      result.result.file.startsWith('https://'),
    financialPnlVerified:false,amountKopecks:null,
    note:'Generation status only, not reconciled profit'});
  }catch(e){return json(503,{code:mapSafeYandexError(e)});}
 }
 return json(400,{code:'invalid_action'});
}
export async function onRequestPost({request,env}){
 if(request.method!=='POST')return json(405,{code:'method_not_allowed'});
 const url=new URL(request.url);
 if(url.pathname!=='/api/yandex/finance-reports'||url.search)
  return json(400,{code:'invalid_scope'});
 if(request.headers.get('Origin')!==url.origin||
   request.headers.get('Sec-Fetch-Site')==='cross-site')
  return json(403,{code:'origin_not_allowed'});
 const issue=await verifyYandexOwner(request,env);
 if(issue)return json(issue.status,{code:issue.code});
 let params;
 try{params=await request.json();}
 catch{return json(400,{code:'invalid_body'});}
 if(!params||!allowedReports.has(params.reportType)||
   !['month,reportType','campaignId,month,reportType'].includes(
      Object.keys(params).sort().join(',')))
  return json(400,{code:'invalid_report_type'});
 let bounds;
 try{bounds=monthBounds(params.month);}
 catch{return json(400,{code:'invalid_month'});}
 // Historical reports are generated only after the month closes.
 if(Date.parse(bounds.dateTo+'T23:59:59Z')>=Date.now())
  return json(400,{code:'month_not_closed'});
 try{
  const campaigns=await listYandexCampaigns(env);
  const scope=selectedBusiness(campaigns);
  const selected=params.campaignId===undefined?scope.campaignIds:
    Number.isSafeInteger(params.campaignId)&&
     scope.campaignIds.includes(params.campaignId)?[params.campaignId]:null;
  if(!selected)return json(400,{code:'campaign_not_accessible'});
  const body={businessId:scope.businessId,
   dateFrom:bounds.dateFrom,dateTo:bounds.dateTo,
   campaignIds:selected};
  const path='/v2/reports/'+reportPaths[params.reportType]+
   '/generate?format=JSON';
  const result=await yandexRequest(env,path,{method:'POST',body});
  const reportId=result.result?.reportId;
  if(typeof reportId!=='string'||!key.test(reportId))
   throw Error('yandex_report_response_invalid');
  return json(200,{code:'yandex_report_requested',
   month:params.month,reportType:params.reportType,
   businessId:scope.businessId,campaignCount:selected.length,
   campaignIds:selected,legalEntity:'ООО · оба магазина одного владельца',
   reportId,status:'PENDING',financialPnlVerified:false,
   profitKopecks:null,
   note:'Yandex is generating source data; no financial results can be claimed yet.'});
 }catch(e){return json(503,{code:mapSafeYandexError(e)});}
}
