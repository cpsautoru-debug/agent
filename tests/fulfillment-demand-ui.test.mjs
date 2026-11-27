import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../web/office/sewing-demand.mjs',import.meta.url),'utf8');
function element(){return {children:[],attrs:{},textContent:'',append(x){this.children.push(x)},replaceChildren(){this.children=[]},addEventListener(k,f){this[k]=f},setAttribute(k,v){this.attrs[k]=v}}}
test('filters use one authenticated fetch, show unknown as N/D and clear old data on failure',async()=>{
 const status=element(),rows=element(),button=element();
 const filters=['all','sewing','review'].map(demandFilter=>Object.assign(element(),{dataset:{demandFilter}}));
 let calls=0,fail=false;
 const document={visibilityState:'hidden',getElementById:id=>({sewingDemandStatus:status,sewingDemandRows:rows,sewingDemandRefresh:button}[id]),querySelectorAll:()=>filters,createElement:element,addEventListener(){}};
 const d={readOnly:true,approvedForDispatch:false,complete:false,counts:{stock:0,production:0,sewing:1,review:1},rows:[{orderKey:'a',sku:'Vesta',category:'sewing',quantity:1},{orderKey:'b',sku:'Priora',category:'review',quantity:null}]};
 vm.runInNewContext(code,{document,window:{addEventListener(){}},location:{hash:'#production'},setInterval(){},Date,AbortSignal,fetch:async(url,opts)=>{calls++;assert.equal(opts.credentials,'same-origin');return {ok:!fail,json:async()=>({demand:d})}}});
 await button.click();assert.equal(rows.children.length,2);
 filters[1].click();assert.equal(rows.children.length,1);assert.equal(rows.children[0].children[1].textContent,'Vesta');assert.equal(filters[1].attrs['aria-pressed'],'true');
 filters[2].click();assert.equal(rows.children[0].children[3].textContent,'Н/Д');assert.equal(calls,1);
 fail=true;await button.click();assert.equal(rows.children.length,0);filters[0].click();assert.equal(rows.children.length,0);assert.match(status.textContent,/недоступна/);
});
