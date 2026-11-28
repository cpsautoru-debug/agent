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
