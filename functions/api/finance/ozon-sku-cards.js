import {verifySession} from '../auth/session.js';
import {
  deriveOzonProfitMissingSkus,validateOzonSellerProductInfo
} from '../../../web/office/finance-ozon-sku-lookup-core.mjs';

const PROFIT_DB='ce9dd331-929d-4c3e-9073-368de3346bc9';
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Vary':'Cookie, Origin'
};
const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const OWNER="SELECT 1 AS allowed FROM office_authorized_users "+
  "WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const KNOWN_SKUS="SELECT sku FROM ozon_cost_entries ORDER BY sku LIMIT 5001";
export function createOzonSkuCardsHandler({
  fetchUpstream=fetch,now=Date.now
}={}){
  return async function({request,env}){
    if(request.method!=='GET')
      return respond(405,{code:'method_not_allowed'});
    const url=new URL(request.url);
    if(url.search||url.hash)
      return respond(400,{code:'invalid_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
      !env.OZON_FINANCE_DB)
      return respond(503,{code:'configuration_unavailable'});
    let stage='owner_auth';
    try{
      const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!actor)return respond(401,{code:'unauthorized'});
      const authorized=await env.OZON_FINANCE_DB.prepare(OWNER)
        .bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
      if(authorized?.allowed!==1)return respond(403,{code:'forbidden'});
      if(!env.OZON_CLIENT_ID||!env.OZON_API_KEY||
        typeof env.OZON_FINANCE_SYNC?.getProfitDocument!=='function')
        return respond(503,{code:'ozon_sku_lookup_not_configured'});

      stage='profit_source';
      const profit=await env.OZON_FINANCE_SYNC.getProfitDocument('costs');
      if(profit?.key!=='costs'||profit.target!==PROFIT_DB||
        !Number.isSafeInteger(profit.version)||profit.version<1||
        !Array.isArray(profit.value?.entries))
        return respond(503,{code:'ozon_profit_source_unavailable'});

      stage='catalog_source';
      const known=await env.OZON_FINANCE_DB.prepare(KNOWN_SKUS).all();
      if(!Array.isArray(known?.results)||known.results.length>5000)
        return respond(503,{code:'ozon_catalog_source_incomplete'});
      const target=deriveOzonProfitMissingSkus(
        profit.value.entries,known.results
      );
      if(target.skus.length===0){
        return respond(200,{
          code:'ozon_sku_cards_lookup',readOnly:true,changedRecords:0,
          source:'ozon_seller_api_v3_product_info_list',
          profitVersion:profit.version,
          missingFromLocalCatalog:target.missingCount,
          attemptedCount:0,foundCount:0,items:[],
          notFound:[],unsupported:target.unsupported,
          accountScope:'connected_ozon_client_only',asOfMs:now()
        });
      }

      stage='seller_api';
      let upstream;
      try{
        upstream=await fetchUpstream(
          'https://api-seller.ozon.ru/v3/product/info/list',{
            method:'POST',
            headers:{
              'Client-Id':env.OZON_CLIENT_ID,'Api-Key':env.OZON_API_KEY,
              'Content-Type':'application/json'
            },
            // A POST to Ozon is used *only to read product information*.
            // No Ozon records are created/updated.
            body:JSON.stringify({sku:target.skus}),
            signal:AbortSignal.timeout(15000)
          }
        );
      }catch{return respond(503,{code:'ozon_seller_api_network_unavailable'});}
      if(upstream.status===429)
        return respond(429,{code:'ozon_seller_api_rate_limited'});
      if(!upstream.ok)
        return respond(503,{code:upstream.status===401||upstream.status===403?
          'ozon_seller_api_auth_failed':'ozon_seller_api_unavailable'});
      stage='seller_response';
      let payload;
      try{payload=await upstream.json();}
      catch{return respond(503,{code:'ozon_seller_api_invalid_response'});}
      const normalized=validateOzonSellerProductInfo(payload,target.skus);
      return respond(200,{
        code:'ozon_sku_cards_lookup',readOnly:true,changedRecords:0,
        source:'ozon_seller_api_v3_product_info_list',
        accountScope:'connected_ozon_client_only',
        profitVersion:profit.version,
        missingFromLocalCatalog:target.missingCount,
        attemptedCount:target.skus.length,
        foundCount:normalized.foundCount,
        items:normalized.items,notFound:normalized.notFound,
        unsupported:target.unsupported,asOfMs:now()
      });
    }catch{
      return respond(503,{
        code:'ozon_sku_lookup_unavailable',
        stage:['profit_source','catalog_source','seller_response']
          .includes(stage)?stage:'unavailable'
      });
    }
  };
}
export const onRequestGet=createOzonSkuCardsHandler();
