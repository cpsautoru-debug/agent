import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sectionForRoute} from '../web/office/office-shell.mjs';
const html=readFileSync(new URL('../web/office/index.html',import.meta.url),'utf8');
test('analytics has its own clickable sidebar route and matching page',()=>{
 assert.match(html,/<a href="#analytics" data-page="analytics">[^<]*<span[^>]*>[^<]*<\/span>Аналитика магазина<\/a>/);
 assert.equal(sectionForRoute('analytics'),'analytics');
 assert.equal(sectionForRoute('wbFinance'),'finance');
 assert.equal(sectionForRoute('finance'),'finance');
 const start=html.indexOf('data-section="analytics"');
 const end=html.indexOf('data-section="finance"',start);
 assert.ok(start>=0&&end>start);
 for(const id of ['unitSkuTitle','unitWbTitle','unitPlannerTitle','salesAnalyticsTitle']){
  assert.ok(html.slice(start,end).includes('id="'+id+'"'),id);
  assert.equal(html.split('id="'+id+'"').length,2,id);
 }
 assert.ok(html.slice(end).includes('id="officeFinanceMetrics"'));
});
test('both navigation implementations recognize the analytics title',()=>{
 for(const file of ['app.js','office-shell.mjs']){
  const js=readFileSync(new URL('../web/office/'+file,import.meta.url),'utf8');
  assert.ok(js.includes("analytics:'Аналитика магазина'"));
 }
});

test('hash navigation opens analytics and marks sidebar link active',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location,CSS:globalThis.CSS};
 const handlers={};
 const attrs=new Map(),classes=new Set();
 const link={dataset:{page:'analytics'},classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k)},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const home={hidden:false},analytics={hidden:true},breadcrumb={textContent:''};
 const loc={hash:'#dashboard'};
 const doc={title:'',querySelector:s=>s==='[data-section="dashboard"]'?home:s==='[data-section="analytics"]'?analytics:null,
 querySelectorAll:s=>s==='[data-section]'?[home,analytics]:s==='.sidebar nav [data-page]'?[link]:[],
 getElementById:id=>id==='breadcrumb'?breadcrumb:null,addEventListener:()=>{}};
 try{
  Object.assign(globalThis,{document:doc,window:{addEventListener:(k,fn)=>handlers[k]=fn},location:loc,CSS:{escape:s=>s}});
  await import('../web/office/office-shell.mjs?analytics-routing-test');
  assert.equal(analytics.hidden,true);
  loc.hash='#analytics';handlers.hashchange();
  assert.equal(analytics.hidden,false);assert.equal(home.hidden,true);
  assert.equal(attrs.get('aria-current'),'page');assert.ok(classes.has('active'));
  assert.equal(breadcrumb.textContent,'Аналитика магазина');
  loc.hash='#dashboard';handlers.hashchange();
  assert.equal(analytics.hidden,true);assert.equal(home.hidden,false);assert.equal(attrs.has('aria-current'),false);
 }finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
