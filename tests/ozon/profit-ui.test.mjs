import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createProfitWorkflow}=require('../../web/office/profit.js');
test('edits invalidate preview and stale asynchronous previews cannot confirm',async()=>{
 let resolve; const calls=[];
 const flow=createProfitWorkflow(payload=>{calls.push(payload);return new Promise(r=>resolve=r);});
 const pending=flow.preview('costs',{entries:[]});flow.clear();resolve({token:'old',key:'costs'});await pending;
 await assert.rejects(flow.confirm(),/предпросмотр/);assert.equal(calls.length,1);
});
test('separate confirmation uses exactly previewed value and clears token',async()=>{
 const calls=[];const flow=createProfitWorkflow(async payload=>{calls.push(payload);return payload.action==='preview'?{token:'one',key:'costs',expiresAt:new Date(Date.now()+60000).toISOString()}:{status:'saved'};});
 await flow.preview('costs',{entries:[]});assert.equal(calls.length,1);await flow.confirm();assert.deepEqual(calls[1],{action:'confirm',token:'one',key:'costs',value:{entries:[]}});await assert.rejects(flow.confirm(),/предпросмотр/);
});
test('expired confirmation is refused without a request',async()=>{
 let calls=0;const flow=createProfitWorkflow(async()=>{calls++;return {token:'x',expiresAt:'2000-01-01T00:00:00Z'};});
 await flow.preview('costs',{});await assert.rejects(flow.confirm(),/истёк/);assert.equal(calls,1);
});

import vm from 'node:vm';
import fs from 'node:fs';
const script=fs.readFileSync(new URL('../../web/office/profit.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.checked=false;this.files=[];}
 append(...children){for(const c of children){c.parent=this;this.children.push(c);}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(){}
 addEventListener(type,fn,capture){(this.listeners[type] ||= []).push({fn,capture});}
 dispatch(type,event={}){for(const {fn} of this.listeners[type]||[])fn({target:this,preventDefault(){},stopImmediatePropagation(){},...event});}
 querySelectorAll(selector){const all=this.children.flatMap(c=>[c,...c.querySelectorAll(selector)]);return selector==='input,select'?all.filter(c=>c.tag==='input'||c.tag==='select'):[];}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
}
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
function browser(fetcher){
 const ids={};for(const match of html.matchAll(/id="([^"]+)"/g))ids[match[1]]=new Element();
 ids.profitAuditKey.value='all';const root=new Element();
 const document={querySelector:()=>root,getElementById:id=>ids[id],createElement:tag=>new Element(tag)};
 const window={listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
 const location={hash:'#overview'};
 vm.runInNewContext(script,{document,window,location,fetch:fetcher,FormData,Date,Intl,JSON,Number,Array,Error,encodeURIComponent});
 return {ids,root,location,window,enter(){location.hash='#ozonProfit';window.listeners.hashchange();}};
}
function response(data,ok=true,status=200){return {ok,status,json:async()=>data};}
const fixture={result:{profit:{status:'blocked',grossKopecks:null,blockers:['Неизвестная стоимость']},skuRows:[{sku:'<img src=x onerror=alert(1)>',name:'Synthetic'}]},configuration:{costs:{entries:[{sku:'SYNTHETIC',costKopecks:12345,validFrom:'2025-01-01',validTo:null,status:'preliminary',source:'Synthetic',leatherDeliveryIncluded:null}]}},audit:[{key:'costs',version:1}],versions:{}};
test('browser loads authenticated no-store, renders unknown and hostile SKU as text, does not write on entry',async()=>{
 const calls=[];const b=browser(async(url,options)=>{calls.push({url,options});return response(fixture);});b.enter();await settle();
 assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.method,undefined);
 assert.equal(b.ids.profitCards.children[0].children[1].textContent,'Неизвестно');assert.equal(b.ids.profitSkuRows.children[0].children[0].textContent,'<img src=x onerror=alert(1)>');assert.equal(b.ids.profitCostRows.children.length,1);
});
test('browser cost editing previews first, edits disable confirm, explicit confirm saves exact draft',async()=>{
 const calls=[];const b=browser(async(url,options)=>{calls.push({url,options});if(!options.method)return response(fixture);const body=JSON.parse(options.body);return response(body.action==='preview'?{token:'token',key:body.key,before:null,after:body.value,warnings:['synthetic warning'],expiresAt:new Date(Date.now()+60000).toISOString()}:{status:'saved'});});b.enter();await settle();
 b.ids.profitCostPreview.dispatch('click');await settle();assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].options.body).action,'preview');assert.equal(b.ids.profitConfirm.disabled,false);assert.match(b.ids.profitAfter.textContent,/12345/);
 b.root.dispatch('input');assert.equal(b.ids.profitConfirm.disabled,true);b.ids.profitConfirm.dispatch('click');await settle();assert.equal(calls.length,2);
 b.ids.profitCostPreview.dispatch('click');await settle();b.ids.profitConfirm.dispatch('click');await settle();const confirm=calls.map(c=>c.options.body&&JSON.parse(c.options.body)).find(c=>c?.action==='confirm');assert.equal(confirm.key,'costs');assert.equal(confirm.value.entries[0].costKopecks,12345);
});
test('browser imported document is re-previewed with explicit owner verification flags',async()=>{
 const calls=[];const b=browser(async(url,options)=>{calls.push({url,options});if(!options.method)return response(fixture);if(options.body instanceof FormData){assert.equal(options.body.get('action'),'preview');assert.ok(options.body.get('report'));return response({token:'import-token',after:{month:b.ids.profitMonth.value,rows:[],quantityVerified:false,periodVerified:false}});}const body=JSON.parse(options.body);return response({token:'final-token',key:body.key,after:body.value});});b.enter();await settle();b.ids.profitFile.files=[new Blob(['synthetic'])];b.ids.profitQuantity.checked=true;b.ids.profitPeriod.checked=false;b.ids.profitMonthPreview.dispatch('click');await settle();assert.equal(calls.length,3);const body=JSON.parse(calls[2].options.body);assert.equal(body.action,'preview');assert.equal(body.value.quantityVerified,true);assert.equal(body.value.periodVerified,false);assert.equal(body.key,'month:'+b.ids.profitMonth.value);
});
test('browser authentication failure clears old totals and never substitutes zeros',async()=>{
 let denied=false;const b=browser(async()=>denied?response({error:'denied'},false,401):response(fixture));b.enter();await settle();denied=true;b.ids.profitReload.dispatch('click');await settle();assert.match(b.ids.profitMessage.textContent,/Требуется вход/);assert.equal(b.ids.profitCards.children[0].children[1].textContent,'Неизвестно');assert.equal(b.ids.profitCostRows.children.length,0);
});
test('legacy cost form is intercepted in capture phase without POST',async()=>{
 let count=0;const b=browser(async()=>{count++;return response(fixture);});let prevented=false,stopped=false;assert.equal(b.ids.ozonCostForm.listeners.submit[0].capture,true);b.ids.ozonCostForm.dispatch('submit',{preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(b.location.hash,'ozonProfit');assert.equal(count,0);
});
test('expense defaults remain unsaved until owner explicitly previews',async()=>{
 let calls=0;const b=browser(async()=>{calls++;return response(fixture);});b.enter();await settle();b.ids.profitExpenseDraft.dispatch('click');assert.equal(calls,1);const draft=JSON.parse(b.ids.profitExpenses.value);assert.deepEqual(draft.items.map(i=>i.amountKopecks),[900000,2000000,2500000]);assert.equal(draft.allocation.method,'unallocated');assert.equal(b.ids.profitConfirm.disabled,true);
});
test('switching month during load queues fresh data and stale response cannot render',async()=>{
 const requests=[];const b=browser((url,options)=>new Promise(resolve=>requests.push({url,options,resolve})));b.enter();b.ids.profitMonth.value='2025-02';b.root.dispatch('change');b.ids.profitMonth.dispatch('change');requests[0].resolve(response(fixture));await settle();assert.equal(requests.length,2);assert.match(requests[1].url,/2025-02/);assert.equal(b.ids.profitCostRows.children.length,0);requests[1].resolve(response(fixture));await settle();assert.equal(b.ids.profitCostRows.children.length,1);
});
test('all referenced UI IDs exist once and navigation is registered',()=>{
 const referenced=[...script.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);for(const id of new Set(referenced))assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,id);assert.match(html,/data-page="ozonProfit"/);assert.match(html,/src="profit.js"/);
});
test('owner expense draft uses exact monthly categories and leather inclusion flag',async()=>{
 const b=browser(async()=>response(fixture));b.enter();await settle();b.ids.profitExpenseDraft.dispatch('click');const draft=JSON.parse(b.ids.profitExpenses.value);
 assert.deepEqual(draft.items.map(({label,amountKopecks,leatherDelivery})=>({label,amountKopecks,leatherDelivery})),[
 {label:'Мусор',amountKopecks:900000,leatherDelivery:false},
 {label:'Доставка кожи',amountKopecks:2000000,leatherDelivery:true},
 {label:'Зарплата удалённого Ильи',amountKopecks:2500000,leatherDelivery:false}
 ]);
});
test('audit key filter supports Worker document_key and legacy key',async()=>{
 const data={...fixture,audit:[{document_key:'costs',version:1},{key:'costs',version:2},{document_key:'expenses',version:3}]};const b=browser(async()=>response(data));b.enter();await settle();b.ids.profitAuditKey.value='costs';b.ids.profitAuditKey.dispatch('change');assert.deepEqual(JSON.parse(b.ids.profitAudit.textContent),data.audit.slice(0,2));
});
test('month target change then root bubbling does not invalidate freshly started load',async()=>{
 const requests=[];const b=browser((url,options)=>new Promise(resolve=>requests.push({url,options,resolve})));b.enter();requests[0].resolve(response(fixture));await settle();
 b.ids.profitMonth.value='2025-03';b.ids.profitMonth.dispatch('change');b.root.dispatch('change',{target:b.ids.profitMonth});assert.equal(requests.length,2);requests[1].resolve(response(fixture));await settle();assert.equal(b.ids.profitCostRows.children.length,1);assert.match(b.ids.profitMessage.textContent,/Данные загружены/);
});
test('profit screen presents sales returns and Russian calculation reasons',async()=>{
 const data={...fixture,result:{...fixture.result,report:{salesKopecks:1234500,returnsKopecks:-10000,groups:[],sourceName:'Synthetic'},profit:{status:'incomplete',blockers:['report_missing','cost_missing','api_unverified_or_incomplete']},tax:{status:'preliminary',reason:'preliminary_AUSN_income_8_percent_estimate;ozon_allocation_missing'},warnings:['UNKNOWN service at row 7'],skuRows:[{sku:'SYNTHETIC',costStatus:'preliminary',reason:'cost_preliminary'}]}};
 const b=browser(async()=>response(data));b.enter();await settle();const cards=b.ids.profitCards.children;const card=label=>cards.find(c=>c.children[0].textContent===label);
 assert.match(card('Продажи · по отчёту').children[1].textContent,/12.*345/);assert.match(card('Возвраты · по отчёту').children[1].textContent,/100/);assert.ok(card('Сальдо API · после удержаний Ozon'));
 assert.match(b.ids.profitStatus.textContent,/Расчёт неполный/);assert.match(b.ids.profitStatus.textContent,/Отчёт начислений не загружен/);assert.match(b.ids.profitStatus.textContent,/Не указана себестоимость/);assert.match(b.ids.profitStatus.textContent,/Неизвестная услуга.*7/);assert.doesNotMatch(b.ids.profitStatus.textContent,/report_missing|cost_missing/);assert.match(b.ids.profitReasons.textContent,/АУСН «Доходы» 8%/);assert.match(b.ids.profitSkuRows.children[0].children[5].textContent,/Предварительно/);
});
test('without report known-cost card remains unknown instead of zero',async()=>{
 const data={...fixture,result:{...fixture.result,report:null,costs:{knownKopecks:0,complete:false}}};const b=browser(async()=>response(data));b.enter();await settle();const card=b.ids.profitCards.children.find(c=>c.children[0].textContent==='Себестоимость · известная часть');assert.equal(card.children[1].textContent,'Неизвестно');
});
test('return recovery editor loads existing records and explicitly previews owner edits',async()=>{
 const recovery={sourceRow:8,sku:'SYNTHETIC',quantity:1,originalSaleDate:'2025-01-03',costKopecks:12345,condition:'resalable',source:'Synthetic original sale',verified:true};
 const data={...fixture,configuration:{...fixture.configuration,month:{month:'2025-01',rows:[{row:8,service:'Возврат выручки',sku:'SYNTHETIC',quantity:1}],returnRecoveries:[recovery]}}};let payload;
 const b=browser(async(url,options)=>{if(!options.method)return response(data);payload=JSON.parse(options.body);return response({token:'preview',after:payload.value});});b.enter();await settle();assert.deepEqual(JSON.parse(b.ids.profitRecoveries.value),[recovery]);assert.match(b.ids.profitReturnRows.textContent,/8/);
 b.ids.profitRecoveries.value=JSON.stringify([{...recovery,condition:'writeoff'}]);b.root.dispatch('input');b.ids.profitMonthPreview.dispatch('click');await settle();assert.equal(payload.value.returnRecoveries[0].condition,'writeoff');assert.equal(payload.value.returnRecoveries[0].costKopecks,12345);
});
test('month preview defaults return recovery to empty for existing documents without that field or editor',async()=>{
 const data={...fixture,configuration:{...fixture.configuration,month:{month:'2025-01',rows:[]}}};let payload;const b=browser(async(url,options)=>{if(!options.method)return response(data);payload=JSON.parse(options.body);return response({token:'preview',after:payload.value});});b.enter();await settle();assert.deepEqual(JSON.parse(b.ids.profitRecoveries.value),[]);delete b.ids.profitRecoveries;b.ids.profitMonthPreview.dispatch('click');await settle();assert.deepEqual(payload.value.returnRecoveries,[]);
});
