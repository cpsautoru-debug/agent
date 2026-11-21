import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT,validateUnitCost}
  from '../../../web/office/wb-unit-economics-core.mjs';

const ORIGIN='https://autosklad63-office-staging.pages.dev';
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Cookie, Origin'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:H});
const encoder=new TextEncoder();
const base64=bytes=>btoa(String.fromCharCode(...bytes))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=value=>{
  if(typeof value!=='string'||value.length>4000||!/^[A-Za-z0-9_-]+$/.test(value))
    throw Error('invalid_cost_confirmation');
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
};
async function hmac(secret){
  return crypto.subtle.importKey('raw',encoder.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function receipt(secret,actor,cost,now){
  const payload={purpose:'wb-unit-cost-preview-v1',account:WB_ACCOUNT,
    actor,document:cost,issuedAt:now,expiresAt:now+600000};
  const data=base64(encoder.encode(JSON.stringify(payload)));
  const signature=base64(new Uint8Array(await crypto.subtle.sign('HMAC',
    await hmac(secret),encoder.encode(data))));
  return data+'.'+signature;
}
async function verifyReceipt(secret,actor,document,token,now){
  if(typeof token!=='string'||token.length>4000)throw Error('invalid_cost_confirmation');
  const parts=token.split('.');
  if(parts.length!==2)throw Error('invalid_cost_confirmation');
  const ok=await crypto.subtle.verify('HMAC',await hmac(secret),
    decode(parts[1]),encoder.encode(parts[0]));
  if(!ok)throw Error('invalid_cost_confirmation');
  const parsed=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if(parsed.purpose!=='wb-unit-cost-preview-v1'||parsed.account!==WB_ACCOUNT||
    parsed.actor!==actor||JSON.stringify(parsed.document)!==JSON.stringify(document)||
    !Number.isSafeInteger(parsed.issuedAt)||parsed.issuedAt>now||
    parsed.expiresAt!==parsed.issuedAt+600000||parsed.expiresAt<=now)
    throw Error('invalid_cost_confirmation');
}
async function bodyJson(request){
  const len=Number(request.headers.get('Content-Length')||0);
  if(len>5000)throw Error('invalid_cost_body');
  const raw=await request.text();
  if(encoder.encode(raw).length>5000)throw Error('invalid_cost_body');
  return JSON.parse(raw);
}
export function createWbCostEntryHandler({now=Date.now}={}){
  return async function({request,env}){
    if(request.method!=='POST')return json(405,{code:'method_not_allowed'});
    try{
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
        !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
        env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
        return json(503,{code:'configuration_unavailable'});
      const url=new URL(request.url);
      if(url.origin!==ORIGIN||url.search||url.hash)
        return json(403,{code:'scope_denied'});
      if(request.headers.get('Origin')!==ORIGIN||
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
          request.headers.get('Content-Type')||'')||
        (request.headers.has('Sec-Fetch-Site')&&
          request.headers.get('Sec-Fetch-Site')!=='same-origin'))
        return json(403,{code:'origin_denied'});
      const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!sub)return json(401,{code:'unauthorized'});
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'forbidden'});
      let data;
      try{data=await bodyJson(request);}catch{return json(400,{code:'invalid_cost_body'});}
      if(!data||!['preview','confirm'].includes(data.action))
        return json(400,{code:'invalid_cost_action'});
      let cost;
      try{
        cost=validateUnitCost(data.document);
        if(data.document?.status==='confirmed'&&data.explicitlyConfirmed!==true)
          throw Error('missing_confirmed_attestation');
      }catch{return json(400,{code:'invalid_cost_document'});}
      const db=env.WB_REPORT_SNAPSHOT_DB;
      const registered=await db.prepare(
        'SELECT 1 AS present FROM wb_finance_api_rows WHERE account_id=? AND vendor_code=? LIMIT 1'
      ).bind(WB_ACCOUNT,cost.vendorCode).first();
      if(registered?.present!==1)
        return json(409,{code:'vendor_code_not_in_wb_finance'});
      const existing=await db.prepare(
        'SELECT 1 AS present FROM wb_profit_unit_costs WHERE account_id=? AND vendor_code=? AND valid_from=? LIMIT 1'
      ).bind(WB_ACCOUNT,cost.vendorCode,cost.validFrom).first();
      if(existing?.present===1)
        return json(409,{code:'unit_cost_version_exists'});
      if(data.action==='preview'){
        return json(200,{
          code:'wb_cost_preview',cost,source:'OWNER_MANUAL_CONFIRMED',
          reminder:'Себестоимость должна включать материал, швею и раскройщика, но не упаковщика, водителя или управляющего.',
          expiryMinutes:10,token:await receipt(env.OFFICE_SESSION_SECRET,sub,cost,now()),
          changedRecords:0
        });
      }
      try{await verifyReceipt(env.OFFICE_SESSION_SECRET,sub,cost,data.token,now());}
      catch{return json(409,{code:'cost_preview_expired_or_changed'});}
      try{
        await db.prepare(
          'INSERT INTO wb_profit_unit_costs (account_id,vendor_code,valid_from,valid_to,cost_kopecks,status,source,actor) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(WB_ACCOUNT,cost.vendorCode,cost.validFrom,cost.validTo,
          cost.costKopecks,cost.status,cost.source,sub).run();
      }catch(e){
        if(/UNIQUE constraint|constraint failed/i.test(String(e?.message||'')))
          return json(409,{code:'unit_cost_concurrent_change'});
        throw e;
      }
      return json(200,{code:'wb_cost_saved',vendorCode:cost.vendorCode,
        validFrom:cost.validFrom,status:cost.status,changedRecords:1});
    }catch{
      return json(503,{code:'wb_cost_registry_unavailable'});
    }
  };
}
export const onRequestPost=createWbCostEntryHandler();
