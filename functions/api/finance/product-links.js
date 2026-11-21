import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
import {
  validateFinanceProductLinkDraft,validatedFinanceProductLinkRead
} from '../../../web/office/finance-product-links-core.mjs';

const ORIGIN='https://autosklad63-office-staging.pages.dev';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Vary':'Cookie, Origin'};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const enc=new TextEncoder(),dec=new TextDecoder();
const base64=bytes=>btoa(String.fromCharCode(...bytes))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unbase64=str=>{
  if(typeof str!=='string'||!str||str.length>6000||!/^[A-Za-z0-9_-]+$/.test(str))
    throw Error('invalid_receipt');
  return Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')),
    x=>x.charCodeAt(0));
};
async function key(secret){
  return crypto.subtle.importKey('raw',enc.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function issue(secret,actor,doc,now){
  const payload={scope:'finance-product-link-v1',actor,doc,
    issuedAt:now,expiresAt:now+600000};
  const data=base64(enc.encode(JSON.stringify(payload)));
  const sig=base64(new Uint8Array(await crypto.subtle.sign('HMAC',
    await key(secret),enc.encode(data))));
  return data+'.'+sig;
}
async function verify(secret,actor,doc,token,now){
  if(typeof token!=='string'||token.length>6500)throw Error('invalid_receipt');
  const parts=token.split('.');
  if(parts.length!==2)throw Error('invalid_receipt');
  const yes=await crypto.subtle.verify('HMAC',
    await key(secret),unbase64(parts[1]),enc.encode(parts[0]));
  if(!yes)throw Error('invalid_receipt');
  const payload=JSON.parse(dec.decode(unbase64(parts[0])));
  if(payload.scope!=='finance-product-link-v1'||
    payload.actor!==actor||
    JSON.stringify(payload.doc)!==JSON.stringify(doc)||
    !Number.isSafeInteger(payload.issuedAt)||
    payload.issuedAt>now||
    payload.expiresAt!==payload.issuedAt+600000||
    payload.expiresAt<=now)throw Error('invalid_receipt');
}
async function readJson(request){
  const h=request.headers.get('Content-Length');
  if(h!==null&&(!/^\d+$/.test(h)||Number(h)>4000))
    throw Error('body_too_large');
  const text=await request.text();
  if(enc.encode(text).length>4000)throw Error('body_too_large');
  return JSON.parse(text);
}
const OWNER="SELECT 1 AS allowed FROM office_authorized_users "+
  "WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const TABLE="SELECT name FROM sqlite_master WHERE type='table' "+
  "AND name='office_finance_product_links' LIMIT 1";
const LIST="SELECT wb_vendor_code,ozon_sku,ozon_seller_article,model_name,"+
  "verified_from,evidence,actor FROM office_finance_product_links "+
  "ORDER BY created_at DESC,wb_vendor_code LIMIT 501";
const WB_EXISTS="SELECT 1 AS found FROM wb_finance_api_rows r "+
  "JOIN wb_finance_api_reports p ON "+
  "p.account_id=r.account_id AND p.report_id=r.report_id "+
  "WHERE r.account_id=? AND r.vendor_code=? AND p.status='complete' LIMIT 1";
const OZON_SKU="SELECT sku,seller_article,model FROM ozon_cost_entries "+
  "WHERE sku=? LIMIT 1";
const ALREADY="SELECT wb_vendor_code,ozon_sku FROM office_finance_product_links "+
  "WHERE wb_vendor_code=? OR ozon_sku=? LIMIT 1";
const INSERT="INSERT INTO office_finance_product_links "+
  "(wb_vendor_code,ozon_sku,ozon_seller_article,model_name,verified_from,evidence,actor) "+
  "VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING wb_vendor_code";

export function createFinanceProductLinksHandler({now=Date.now}={}){
  return async function({request,env}){
    if(!['GET','POST'].includes(request.method))
      return json(405,{code:'method_not_allowed'});
    let stage='configuration';
    try{
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
        !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
        env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
        return json(503,{code:'configuration_unavailable'});
      const url=new URL(request.url);
      if(url.search||url.hash)return json(400,{code:'unsupported_scope'});
      if(request.method==='POST'){
        if(url.origin!==ORIGIN||request.headers.get('Origin')!==ORIGIN||
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
            request.headers.get('Content-Type')||'')||
          (request.headers.has('Sec-Fetch-Site')&&
            request.headers.get('Sec-Fetch-Site')!=='same-origin'))
          return json(403,{code:'origin_denied'});
      }
      const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!actor)return json(401,{code:'unauthorized'});
      const owner=await env.OZON_FINANCE_DB.prepare(OWNER)
        .bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'forbidden'});

      const db=env.OZON_FINANCE_DB;
      stage='schema';
      const found=await db.prepare(TABLE).first();
      if(found?.name!=='office_finance_product_links')
        return json(request.method==='GET'?200:409,{
          code:'finance_product_links_migration_required',
          status:'migration_required',readOnly:true,changedRecords:0
        });
      if(request.method==='GET'){
        stage='read';
        const raw=await db.prepare(LIST).all();
        const links=validatedFinanceProductLinkRead(raw?.results);
        return json(200,{
          code:'finance_product_links',status:'ready',readOnly:true,
          changedRecords:0,links,count:links.length,asOfMs:now()
        });
      }

      let body,draft;
      try{
        body=await readJson(request);
        if(!['preview','confirm'].includes(body?.action))
          throw Error('invalid_action');
        draft=validateFinanceProductLinkDraft(body.document);
      }catch{return json(400,{code:'invalid_product_link'});}
      stage='source_verification';
      const [wb,ozon,existing]=await Promise.all([
        env.WB_REPORT_SNAPSHOT_DB.prepare(WB_EXISTS)
          .bind(WB_ACCOUNT,draft.wbVendorCode).first(),
        db.prepare(OZON_SKU).bind(draft.ozonSku).first(),
        db.prepare(ALREADY).bind(draft.wbVendorCode,draft.ozonSku).first()
      ]);
      if(wb?.found!==1||!ozon?.sku||
        ozon.sku!==draft.ozonSku||
        typeof ozon.seller_article!=='string'||!ozon.seller_article||
        typeof ozon.model!=='string'||!ozon.model)
        return json(409,{code:'product_source_not_verified'});
      if(existing)return json(409,{code:'product_link_already_exists'});
      const doc={...draft,
        ozonSellerArticle:ozon.seller_article,modelName:ozon.model};
      if(body.action==='preview'){
        return json(200,{
          code:'finance_product_link_preview',
          readOnly:true,changedRecords:0,
          document:doc,expiryMinutes:10,
          warning:'Подтверждается идентичность изделия. Себестоимость не переносится.',
          token:await issue(env.OFFICE_SESSION_SECRET,actor,doc,now())
        });
      }
      try{
        await verify(env.OFFICE_SESSION_SECRET,actor,doc,body.token,now());
      }catch{return json(409,{code:'product_link_preview_changed_or_expired'});}

      stage='insert';
      const saved=await db.prepare(INSERT).bind(
        doc.wbVendorCode,doc.ozonSku,doc.ozonSellerArticle,
        doc.modelName,doc.verifiedFrom,doc.evidence,actor
      ).first();
      if(saved?.wb_vendor_code!==doc.wbVendorCode)
        return json(409,{code:'product_link_conflict_refresh'});
      return json(200,{
        code:'finance_product_link_saved',changedRecords:1,
        wbVendorCode:doc.wbVendorCode,ozonSku:doc.ozonSku,
        costTransferred:false
      });
    }catch{
      return json(503,{
        code:'finance_product_links_unavailable',
        stage:['schema','read','source_verification','insert']
          .includes(stage)?stage:'unavailable'
      });
    }
  };
}
export const onRequestGet=createFinanceProductLinksHandler();
export const onRequestPost=createFinanceProductLinksHandler();
