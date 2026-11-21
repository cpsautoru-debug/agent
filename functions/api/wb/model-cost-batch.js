import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
import {validateModelCostBatch} from '../../../web/office/wb-model-cost-bulk-core.mjs';

const ORIGIN='https://autosklad63-office-staging.pages.dev';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Vary':'Cookie, Origin'};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=str=>{
  if(typeof str!=='string'||str.length>10000||!/^[\w-]+$/.test(str))
    throw Error('invalid_receipt');
  return Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')),
    c=>c.charCodeAt(0));
};
const hmac=secret=>crypto.subtle.importKey('raw',enc.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
async function previewReceipt(secret,sub,doc,now){
  const payload={scope:'wb-model-cost-batch-v1',actor:sub,account:WB_ACCOUNT,
    doc,issued:now,expires:now+600000};
  const data=b64(enc.encode(JSON.stringify(payload)));
  const signature=b64(new Uint8Array(await crypto.subtle.sign('HMAC',
    await hmac(secret),enc.encode(data))));
  return data+'.'+signature;
}
async function verifyReceipt(secret,sub,doc,token,now){
  if(typeof token!=='string'||token.length>10000)throw Error('invalid_receipt');
  const parts=token.split('.');
  if(parts.length!==2)throw Error('invalid_receipt');
  const valid=await crypto.subtle.verify('HMAC',await hmac(secret),
    unb64(parts[1]),enc.encode(parts[0]));
  if(!valid)throw Error('invalid_receipt');
  const payload=JSON.parse(dec.decode(unb64(parts[0])));
  if(payload.scope!=='wb-model-cost-batch-v1'||payload.actor!==sub||
    payload.account!==WB_ACCOUNT||JSON.stringify(payload.doc)!==JSON.stringify(doc)||
    !Number.isSafeInteger(payload.issued)||payload.issued>now||
    payload.expires!==payload.issued+600000||payload.expires<=now)
    throw Error('invalid_receipt');
}
async function parseBody(request){
  const length=Number(request.headers.get('Content-Length')||0);
  if(!Number.isFinite(length)||length>9000)throw Error('body_too_large');
  const raw=await request.text();
  if(enc.encode(raw).byteLength>9000)throw Error('body_too_large');
  return JSON.parse(raw);
}
const placeholders=items=>items.map(()=>'?').join(',');
export function createWbModelCostBatchHandler({now=Date.now}={}){
  return async function({request,env}){
    if(request.method!=='POST')return json(405,{code:'method_not_allowed'});
    try{
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
        !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
        env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
        return json(503,{code:'configuration_unavailable'});
      const url=new URL(request.url);
      if(url.origin!==ORIGIN||url.search||url.hash||
        request.headers.get('Origin')!==ORIGIN||
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
          request.headers.get('Content-Type')||'')||
        (request.headers.has('Sec-Fetch-Site')&&
         request.headers.get('Sec-Fetch-Site')!=='same-origin'))
        return json(403,{code:'origin_denied'});
      const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!actor)return json(401,{code:'unauthorized'});
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
      ).bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'forbidden'});

      let body,doc;
      try{
        body=await parseBody(request);
        if(!['preview','confirm'].includes(body?.action))
          throw Error('invalid_action');
        doc=validateModelCostBatch(body.document);
      }catch{return json(400,{code:'invalid_model_cost_batch'});}
      const db=env.WB_REPORT_SNAPSHOT_DB;
      const sqlParams=placeholders(doc.vendorCodes);
      // Check actual source IDs, not only the text-prefix classifier.
      const present=await db.prepare(
        'SELECT DISTINCT r.vendor_code AS vendor_code FROM wb_finance_api_rows r '+
        'JOIN wb_finance_api_reports p ON p.account_id=r.account_id AND p.report_id=r.report_id '+
        "WHERE r.account_id=? AND p.status='complete' AND r.vendor_code IN ("+
        sqlParams+')'
      ).bind(WB_ACCOUNT,...doc.vendorCodes).all();
      if(!Array.isArray(present?.results)||
        present.results.length!==doc.vendorCodes.length||
        new Set(present.results.map(x=>x.vendor_code)).size!==doc.vendorCodes.length||
        present.results.some(x=>!doc.vendorCodes.includes(x.vendor_code)))
        return json(409,{code:'wb_articles_changed_refresh_required'});
      // First rollout is create-only for a costless group, never overwrite
      // any effective-dated manual price, even with a different date.
      const existing=await db.prepare(
        'SELECT vendor_code FROM wb_profit_unit_costs '+
        'WHERE account_id=? AND vendor_code IN ('+sqlParams+') LIMIT 1'
      ).bind(WB_ACCOUNT,...doc.vendorCodes).first();
      if(existing)return json(409,{code:'existing_cost_version_requires_individual_review'});
      if(body.action==='preview'){
        return json(200,{
          code:'wb_model_cost_batch_preview',changedRecords:0,
          familyId:doc.familyId,vendorCodes:doc.vendorCodes,
          count:doc.vendorCodes.length,costKopecks:doc.costKopecks,
          validFrom:doc.validFrom,status:doc.status,
          source:doc.source,
          warning:'Все выбранные артикулы должны быть одним реальным изделием/техкартой. Дата должна покрывать нужные отчёты; запись неизменяема.',
          expiryMinutes:10,
          token:await previewReceipt(env.OFFICE_SESSION_SECRET,actor,doc,now())
        });
      }
      try{
        await verifyReceipt(env.OFFICE_SESSION_SECRET,actor,doc,body.token,now());
      }catch{return json(409,{code:'batch_preview_expired_or_changed'});}
      // D1 batch executes statements transactionally: either the entire
      // selected group is inserted or the DB reports failure.
      const statements=doc.vendorCodes.map(vendorCode=>db.prepare(
        'INSERT INTO wb_profit_unit_costs '+
        '(account_id,vendor_code,valid_from,valid_to,cost_kopecks,status,source,actor) '+
        'VALUES (?,?,?,NULL,?,?,?,?)'
      ).bind(WB_ACCOUNT,vendorCode,doc.validFrom,doc.costKopecks,
        doc.status,'Группа '+doc.familyId+'; '+doc.source,actor));
      const result=await db.batch(statements);
      if(!Array.isArray(result)||result.length!==statements.length||
        result.some(x=>x?.success!==true))
        return json(503,{code:'batch_write_not_verified'});
      return json(200,{
        code:'wb_model_cost_batch_saved',changedRecords:statements.length,
        familyId:doc.familyId,costKopecks:doc.costKopecks,
        validFrom:doc.validFrom,status:doc.status
      });
    }catch{
      return json(503,{code:'wb_model_cost_batch_unavailable'});
    }
  };
}
export const onRequestPost=createWbModelCostBatchHandler();
