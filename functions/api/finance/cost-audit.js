import {verifySession} from '../auth/session.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
import {auditUnifiedCostSources} from '../../../web/office/unified-cost-audit-core.mjs';
import {applyOwnerConfirmedOzonCosts} from '../../../web/office/owner-cost-confirmations.mjs';

const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Vary':'Cookie, Origin'
};
const json=(status,data)=>new Response(JSON.stringify(data),{
  status,headers:HEADERS
});
const OWNER="SELECT 1 AS allowed FROM office_authorized_users "+
  "WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const WB_COSTS="SELECT vendor_code,valid_from,valid_to,cost_kopecks,status,source "+
  "FROM wb_profit_unit_costs WHERE account_id=? "+
  "ORDER BY vendor_code,valid_from LIMIT 2001";
const OZON_COSTS="SELECT sku,seller_article,model,cost_kopecks,status,source "+
  "FROM ozon_cost_entries ORDER BY seller_article,sku LIMIT 5001";

export function createUnifiedCostAuditHandler({now=Date.now}={}){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let stage='authorization';
    try{
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
        !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
        env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT)
        return json(503,{code:'configuration_unavailable'});
      const url=new URL(request.url);
      const params=[...url.searchParams.keys()];
      if(params.some(x=>x!=='month')||params.length>1||url.hash)
        return json(400,{code:'invalid_period'});
      const month=url.searchParams.get('month')||
        new Date(now()).toISOString().slice(0,7);
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        return json(400,{code:'invalid_period'});
      const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!actor)return json(401,{code:'unauthorized'});
      const owner=await env.OZON_FINANCE_DB.prepare(OWNER)
        .bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'forbidden'});

      stage='wb_costs_read';
      const wb=env.WB_REPORT_SNAPSHOT_DB;
      const table=await wb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='wb_profit_unit_costs' LIMIT 1"
      ).first();
      const wbRegistryStatus=table?.name==='wb_profit_unit_costs'?
        'ready':'migration_required';
      const wbResult=wbRegistryStatus==='ready'?
        await wb.prepare(WB_COSTS).bind(WB_ACCOUNT).all():
        {results:[]};
      if(!Array.isArray(wbResult?.results)||wbResult.results.length>2000)
        return json(503,{code:'wb_cost_catalog_incomplete'});

      stage='ozon_auxiliary_costs_read';
      const ozonResult=await env.OZON_FINANCE_DB.prepare(OZON_COSTS).all();
      if(!Array.isArray(ozonResult?.results)||
        ozonResult.results.length>5000)
        return json(503,{code:'ozon_cost_catalog_incomplete'});

      const confirmedCostEvidence=applyOwnerConfirmedOzonCosts(ozonResult.results);

      // Profit uses a DIFFERENT, versioned D1 behind the existing service
      // binding. Do not confuse the auxiliary ozon_cost_entries table with
      // the costs document the Profit calculator actually uses.
      let ozonProfitStatus='unavailable',ozonExpensesStatus='unavailable';
      let profitDoc=null,expensesDoc=null,profitVersion=0,expenseVersion=0;
      const rpc=env.OZON_FINANCE_SYNC;
      if(rpc&&typeof rpc.getProfitDocument==='function'){
        stage='ozon_profit_rpc';
        try{
          const reply=await rpc.getProfitDocument('costs');
          if(reply?.key==='costs'&&
            reply.target==='ce9dd331-929d-4c3e-9073-368de3346bc9'&&
            Number.isSafeInteger(reply.version)&&reply.version>=0){
            ozonProfitStatus='ready';
            profitDoc=reply.value;
            profitVersion=reply.version;
          }
        }catch{/* Fail visibly as unavailable; do not invent empty catalog. */}
        stage='ozon_expenses_rpc';
        try{
          const reply=await rpc.getProfitDocument('expenses');
          if(reply?.key==='expenses'&&
            reply.target==='ce9dd331-929d-4c3e-9073-368de3346bc9'&&
            Number.isSafeInteger(reply.version)&&reply.version>=0){
            ozonExpensesStatus='ready';
            expensesDoc=reply.value;
            expenseVersion=reply.version;
          }
        }catch{/* Known source missing, not an implicit zero. */}
      }
      // The primary Ozon Profit cost ledger contains SKU identifiers.
      // A verified same-month source file contains their seller articles and
      // names; expose only owner-safe product identities, no sales rows.
      let ozonProfitCards={status:'unavailable',items:[]};
      if(rpc&&typeof rpc.getProfitDocument==='function'&&
         profitDoc&&Array.isArray(profitDoc.entries)){
        try{
          const monthDoc=await rpc.getProfitDocument('month:'+month);
          if(monthDoc?.key==='month:'+month&&
             monthDoc.target==='ce9dd331-929d-4c3e-9073-368de3346bc9'&&
             Array.isArray(monthDoc.value?.rows)&&
             monthDoc.value.rows.length<=20000){
            const required=new Set(profitDoc.entries.map(x=>String(x.sku)));
            const cards=new Map();
            for(const row of monthDoc.value.rows){
              const sku=String(row?.sku||'');
              if(!required.has(sku)||cards.has(sku)||
                 typeof row?.name!=='string'||!row.name.trim()||
                 typeof row.article!=='string'||!row.article.trim())continue;
              cards.set(sku,{sku,name:row.name.slice(0,250),
                sellerArticle:row.article.slice(0,250)});
            }
            ozonProfitCards={status:'ready',items:[...cards.values()]};
          }
        }catch{/* Other sources still usable, never assume empty cards. */}
      }
      stage='source_validation';
      const audit=auditUnifiedCostSources({
        month,wbRows:wbResult.results,wbRegistryStatus,
        ozonCatalogRows:confirmedCostEvidence.rows,
        ozonProfitDocument:profitDoc,ozonProfitStatus,
        ozonExpensesDocument:expensesDoc,ozonExpensesStatus,
        profitVersion,expenseVersion
      });
      return json(200,{...audit,ozonProfitCards,
        ownerConfirmedCostDecisions:confirmedCostEvidence.decisions,
        ownerConfirmedCostStatus:'read_side_adjustment_pending_D1_permission',
        asOfMs:now()});
    }catch{
      return json(503,{code:'unified_cost_audit_unavailable',
        stage:['wb_costs_read','ozon_auxiliary_costs_read',
          'source_validation'].includes(stage)?stage:'unavailable'});
    }
  };
}
export const onRequestGet=createUnifiedCostAuditHandler();
