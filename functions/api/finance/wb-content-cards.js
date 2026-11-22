import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
import {
  inspectWbCardsPage,finalizeWbCardLookup
} from '../../../web/office/finance-wb-card-lookup-core.mjs';

const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'Vary':'Cookie, Origin'
};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const OWNER="SELECT 1 AS allowed FROM office_authorized_users "+
  "WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const FINANCE_CODES="SELECT DISTINCT r.vendor_code AS vendorCode "+
  "FROM wb_finance_api_rows r JOIN wb_finance_api_reports p "+
  "ON p.account_id=r.account_id AND p.report_id=r.report_id "+
  "WHERE r.account_id=? AND p.status='complete' AND "+
  "r.vendor_code IS NOT NULL AND length(r.vendor_code)>0 "+
  "ORDER BY r.vendor_code LIMIT 2001";
const HOST='https://content-api.wildberries.ru/content/v2/get/cards/list';
const MAX_PAGES=3;
export function createWbContentCardLookupHandler({
  fetchUpstream=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))
}={}){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    const url=new URL(request.url);
    if(url.search||url.hash)return json(400,{code:'invalid_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
      !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
      env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
      return json(503,{code:'wb_card_lookup_configuration_unavailable'});
    const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
    if(!actor)return json(401,{code:'unauthorized'});
    try{
      const owner=await env.OZON_FINANCE_DB.prepare(OWNER)
        .bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'forbidden'});
      const token=env.WB_CONTENT_API_TOKEN||env.WB_API_TOKEN;
      if(typeof token!=='string'||!token||/\s/u.test(token))
        return json(503,{code:'wb_content_token_not_configured',
          requiredScope:'content_read'});
      const data=await env.WB_REPORT_SNAPSHOT_DB.prepare(FINANCE_CODES)
        .bind(WB_ACCOUNT).all();
      const codes=data?.results?.map(x=>x.vendorCode);
      if(!Array.isArray(codes)||codes.length>2000||
        codes.some(x=>typeof x!=='string'||!x||x.length>200))
        return json(503,{code:'wb_content_finance_codes_unavailable'});
      const found=new Map(),duplicates=new Set(),cursorKeys=new Set();
      let cursor={},complete=false,pages=0;
      while(pages<MAX_PAGES){
        let res;
        const body={settings:{
          sort:{ascending:true},
          filter:{withPhoto:-1},
          cursor:{limit:100,...cursor}
        }};
        try{
          res=await fetchUpstream(HOST,{
            method:'POST',
            headers:{Authorization:token,'Content-Type':'application/json',
              Accept:'application/json'},
            body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
          });
        }catch{return json(503,{code:'wb_content_api_network_unavailable'});}
        if(res.status===401||res.status===403)
          return json(403,{code:'wb_content_scope_required',
            requiredScope:'content_read'});
        if(res.status===429)
          return json(429,{code:'wb_content_api_rate_limited'});
        if(!res.ok)
          return json(503,{code:'wb_content_api_unavailable'});
        let page;
        try{page=inspectWbCardsPage(await res.json(),codes);}
        catch{return json(503,{code:'wb_content_api_invalid_response'});}
        pages++;
        for(const item of page.entries){
          if(found.has(item.vendorCode)){
            duplicates.add(item.vendorCode);found.delete(item.vendorCode);
          }else if(!duplicates.has(item.vendorCode))
            found.set(item.vendorCode,item);
        }
        if(page.total<100){
          complete=true;break;
        }
        const at=page.cursor;
        if(typeof at?.updatedAt!=='string'||
          !Number.isSafeInteger(at.nmID)||at.nmID<=0)
          return json(503,{code:'wb_content_api_cursor_unavailable'});
        const key=at.updatedAt+'|'+at.nmID;
        if(cursorKeys.has(key))
          return json(503,{code:'wb_content_api_cursor_repeated'});
        cursorKeys.add(key);
        cursor={updatedAt:at.updatedAt,nmID:at.nmID};
        if(pages<MAX_PAGES)await wait(800);
      }
      const result=finalizeWbCardLookup({
        codes,found:[...found.values()],complete,pages
      });
      return json(200,{
        code:'wb_content_card_lookup',source:'wb_content_api_live',
        ...result,
        duplicateCardCodes:[...duplicates],
        accountScope:'connected_wb_content_token_only',
        note:'Только текущие карточки из Content API: финансовый артикул сопоставляется по точному vendorCode. Название не подтверждает состав и себестоимость.'
      });
    }catch{
      return json(503,{code:'wb_content_card_lookup_unavailable'});
    }
  };
}
export const onRequestGet=createWbContentCardLookupHandler();
