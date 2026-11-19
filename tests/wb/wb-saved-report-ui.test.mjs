import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../../web/office/wb-saved-report.js',import.meta.url),'utf8');
function harness(responses){
 class Element{constructor(){this.children=[];this.listeners={};this.value='';this.files=[];this.textContent='';}appendChild(x){this.children.push(x);return x}addEventListener(n,f){this.listeners[n]=f}replaceChildren(){this.children=[]}}
 const ids=Object.fromEntries(['wbImportPreviewForm','wbImportPreviewReportId','wbImportPreviewPayout','wbImportPreviewXlsx','wbImportPreviewCatalog'].map(id=>[id,new Element()]));
 ids.wbImportPreviewForm.parentElement=new Element();const calls=[];
 const document={getElementById:id=>ids[id],createElement:()=>new Element()};
 class FD{append(){}}
 runInNewContext(code,{document,FormData:FD,Intl,BigInt,fetch:async(url,opts)=>{calls.push({url,opts});const r=responses.shift();return {ok:r.status<300,status:r.status,json:async()=>r.body}}});
 return {ids,calls,panel:ids.wbImportPreviewForm.parentElement.children[0]};
}
const snapshot={reportId:'865265818',periodStart:'2026-10-01',periodEnd:'2026-10-04',preview:{sales:22,returns:1,estimate:{payoutKop:7922633,cogsKop:4884600,taxKop:100,profitWithoutRestorationKop:3037933}}};
test('reload reads persisted test report and displays real source with preliminary profit',async()=>{const h=harness([{status:200,body:{persisted:true,storage:'TEST_D1',snapshot}}]);await new Promise(r=>setImmediate(r));assert.match(h.calls[0].url,/saved-report.*865265818/);assert.match(h.panel.children[2].textContent,/22/);assert.match(h.panel.children[2].textContent,/48.*846/);assert.match(h.panel.children[3].textContent,/предварительные/);assert.equal(h.calls[0].opts.method,'GET')});
test('missing report shown honestly and no automatic save',async()=>{const h=harness([{status:404,body:{}}]);await new Promise(r=>setImmediate(r));assert.match(h.panel.children[2].textContent,/не сохранён/);assert.equal(h.calls.length,1)});
test('save requires chosen files and matching pilot, no POST on invalid form',async()=>{const h=harness([{status:404,body:{}}]);await new Promise(r=>setImmediate(r));h.ids.wbImportPreviewForm.listeners['wb-preview-validated']({detail:{reportId:'865265818'}});await h.panel.children[1].listeners.click();assert.equal(h.calls.length,1);assert.match(h.panel.children[2].textContent,/Выберите/)});
test('save POST is explicit with same-origin credentials, no automatic retry after conflict',async()=>{const h=harness([{status:404,body:{}},{status:409,body:{}}]);await new Promise(r=>setImmediate(r));h.ids.wbImportPreviewReportId.value='865265818';h.ids.wbImportPreviewPayout.value='79226,33';h.ids.wbImportPreviewXlsx.files=[{}];h.ids.wbImportPreviewCatalog.files=[{}];h.ids.wbImportPreviewForm.listeners['wb-preview-validated']({detail:{reportId:'865265818'}});await h.panel.children[1].listeners.click();assert.equal(h.calls.length,2);assert.equal(h.calls[1].opts.method,'POST');assert.equal(h.calls[1].opts.credentials,'same-origin');assert.equal(h.calls[1].opts.headers['X-WB-Save-Report'],'1');assert.match(h.panel.children[2].textContent,/отличаются/)});

test('button hidden until authorized successful preview, invalidated on input change',async()=>{const h=harness([{status:404,body:{}}]);await new Promise(r=>setImmediate(r));assert.equal(h.panel.children[1].hidden,true);h.ids.wbImportPreviewForm.listeners['wb-preview-validated']({detail:{reportId:'865265818'}});assert.equal(h.panel.children[1].hidden,false);h.ids.wbImportPreviewForm.listeners.input();assert.equal(h.panel.children[1].hidden,true);assert.equal(h.calls.length,1)});
test('unauthorized user never gets save button even after preview event',async()=>{const h=harness([{status:401,body:{}}]);await new Promise(r=>setImmediate(r));h.ids.wbImportPreviewForm.listeners['wb-preview-validated']({detail:{reportId:'865265818'}});assert.equal(h.panel.children[1].hidden,true)});
test('published markup loads WB assets from root on nested office route',()=>{const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');for(const asset of ['/wb-import-preview.js','/wb-saved-report.js?v=wb-save-button-2','/wb-import-preview.css'])assert.ok(html.includes('"'+asset+'"'));});
