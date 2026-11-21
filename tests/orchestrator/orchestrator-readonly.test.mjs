import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const routeSource=await readFile(
  new URL('../../functions/api/orchestrator/chat.js',import.meta.url),'utf8'
);
const source=routeSource
  .replace("import {verifySession} from '../auth/session.js';",
    "const verifySession=async r=>r.headers.get('Cookie')==='owner-test'?'owner-id':null;")
  .replace("import {onRequestGet as wbUnitEconomics} from '../wb/unit-economics.js';",
    "const wbUnitEconomics=async()=>new Response(JSON.stringify({source:'WB_FINANCE_API_D1',articles:[],blockers:['missing_cost_catalog'],netProfitKopecks:null}),{status:200});")
  .replace("import {onRequestGet as ozonProfit} from '../ozon/profit.js';",
    "const ozonProfit=async()=>new Response(JSON.stringify({result:{month:'2026-11',profit:{status:'incomplete',netEstimateKopecks:null},skuRows:[]}}),{status:200});");
assert.equal(source.includes('import {verifySession}'),false);
assert.equal(source.includes('import {onRequestGet as wbUnitEconomics}'),false);
const route=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function env(key='sk-test-not-a-real-key'){
  return {
    OFFICE_SESSION_SECRET:'local-only',OFFICE_ALLOWED_EMAIL:'owner@example.test',
    OPENAI_API_KEY:key,
    OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})}
  };
}
function request(message,{cookie='owner-test',origin='https://office.example',fetchSite='same-origin',contentType='application/json'}={}){
  return new Request('https://office.example/api/orchestrator/chat',{
    method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':contentType,'Sec-Fetch-Site':fetchSite},
    body:JSON.stringify({message})
  });
}

test('routes only explicitly supported finance sources',()=>{
  assert.deepEqual(route.sourceSelection('Прибыль WB'),['wb']);
  assert.deepEqual(route.sourceSelection('Как дела на Ozon?'),['ozon']);
  assert.deepEqual(route.sourceSelection('Сравни Wildberries и Ozon'),['wb','ozon']);
  assert.deepEqual(route.sourceSelection('Как идут заказы на раскрой?'),[]);
});

test('unconfirmed WB and Ozon profit remains unconfirmed',()=>{
  const wb=route.summarizeWb({source:'WB_FINANCE_API_D1',articles:[],
    netProfitKopecks:null,profitVerified:false,blockers:['advertising_missing']},'wb');
  assert.equal(wb.netProfitKopecks,null);
  assert.equal(wb.profitVerified,false);
  const ozon=route.summarizeOzon({result:{month:'2026-11',
    profit:{status:'incomplete',netEstimateKopecks:null},skuRows:[]}},'ozon');
  assert.equal(ozon.profit.status,'incomplete');
  assert.equal(ozon.profit.netEstimateKopecks,null);
});

test('rejects requests without owner session, from cross-origin and without API key',async()=>{
  const unauthorized=await route.onRequestPost({request:request('WB',{cookie:'wrong'}),env:env()});
  assert.equal(unauthorized.status,401);
  const csrf=await route.onRequestPost({request:request('WB',{origin:'https://attacker.example'}),env:env()});
  assert.equal(csrf.status,403);
  const missing=await route.onRequestPost({request:request('WB'),env:env('')});
  assert.equal(missing.status,503);
});

test('unsupported production requests do not call an LLM or any business write operation',async()=>{
  const res=await route.onRequestPost({
    request:request('Как идут работы на раскрое?'),env:env()
  });
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.code,'source_not_connected');
  assert.equal(data.readOnly,true);
});

test('OpenAI request is stateless, bounded, and includes no write tools',async()=>{
  let seen;
  const fakeFetch=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    seen=JSON.parse(options.body);
    return new Response(JSON.stringify({output:[{type:'message',content:[
      {type:'output_text',text:'Имеющиеся данные не подтверждают прибыль.'}
    ]}],usage:{input_tokens:50,output_tokens:14}}),{status:200});
  };
  const r=await route.createOrchestratorReply('Оцени прибыль',[
    {source:'wb',status:'ok',data:{netProfitKopecks:null}}
  ],env(),fakeFetch);
  assert.equal(seen.store,false);
  assert.equal(seen.max_output_tokens,650);
  assert.equal(seen.tools,undefined);
  assert.match(r.answer,/не подтверждают прибыль/);
});
