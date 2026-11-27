import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCatalogPage} from '../workers/ms-assortment-sync.mjs';
import {directoryPage} from '../functions/api/orders/ms-sales-directory.js';
const id='7d3da55a-760f-11f1-0a80-066a00250941';
const item={id,name:'Vesta',archived:false,itemType:'product',article:'A',code:'B',updated:null,barcodes:['1234567890123'],characteristics:[]};
const page={code:'sales_directory_ok',type:'assortment',readOnly:true,changedRecords:0,total:1,items:[item],nextOffset:null};
test('assortment page retains identity and barcode',async()=>{
 const r=await directoryPage(async()=>({meta:{size:1},rows:[{id,name:'Vesta',article:'A',code:'B',barcodes:[{ean13:'1234567890123'}],meta:{type:'product',href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+id}}]}),'assortment');
 assert.deepEqual(r.items,[item]);
 assert.deepEqual(validateCatalogPage(page,0,null),{next:1,complete:true});
});
test('assortment rejects inconsistent counts, cursor and identity',()=>{
 for(const p of [{...page,total:2},{...page,nextOffset:1},{...page,changedRecords:1},{...page,items:[{...item,id:'invalid'}]}])assert.throws(()=>validateCatalogPage(p,0,null));
 assert.throws(()=>validateCatalogPage(page,0,2));
});
test('assortment resumes at final page',()=>{
 assert.deepEqual(validateCatalogPage({...page,total:26},25,26),{next:26,complete:true});
});
