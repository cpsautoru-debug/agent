import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../web/office/staff-preview.mjs',import.meta.url),'utf8');
function element(){return {children:[],textContent:'',disabled:false,append(x){this.children.push(x)},replaceChildren(){this.children=[]},addEventListener(k,f){this[k]=f}}}
test('staff view renders only selected role, clears stale responses and fails closed',async()=>{
 const role=Object.assign(element(),{value:'orders'}),button=element(),status=element(),rows=element();
 let resolve;const document={getElementById:id=>({staffPreviewRole:role,staffPreviewRefresh:button,staffPreviewStatus:status,staffPreviewRows:rows}[id]),createElement:element};
 const payload={code:'staff_preview',role:'orders',ownerPreview:true,readOnly:true,approvedForDispatch:false,approvedForProduction:false,complete:false,rows:[{orderKey:'AS63:wb:wb-primary:123',source:'wb',reason:'needs_stock_and_sku_check',items:[{sku:'vesta',quantity:1}]}]};
 vm.runInNewContext(code,{document,window:{addEventListener(){}},AbortSignal,encodeURIComponent,fetch:()=>new Promise(r=>{resolve=r})});
 let pending=button.click();resolve({ok:true,json:async()=>payload});await pending;
 assert.equal(rows.children.length,1);assert.equal(rows.children[0].children[2].textContent,'vesta');assert.equal(rows.children[0].children[0].textContent,'123');assert.equal(rows.children[0].children[0].title,'AS63:wb:wb-primary:123');assert.equal(rows.children[0].children[1].textContent,'Wildberries');assert.equal(rows.children[0].children[4].textContent,'Проверить товар и остаток');assert.match(status.textContent,/неполные/);
 pending=button.click();role.value='sewing';role.change();resolve({ok:true,json:async()=>payload});await pending;assert.equal(rows.children.length,0);assert.equal(button.disabled,false);
 pending=button.click();resolve({ok:false,json:async()=>({})});await pending;assert.equal(rows.children.length,0);assert.match(status.textContent,/недоступно/);
});
