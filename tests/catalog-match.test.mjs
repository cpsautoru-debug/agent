import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueCandidates} from '../functions/api/ms/catalog-match.mjs';
const now=Date.parse('2026-11-27T12:00:00Z');
const current={generation:'g',row_count:735,started_at:'2026-11-27T04:30:00Z',completed_at:'2026-11-27T11:45:00Z'};
const item={id:'7d3da55a-760f-11f1-0a80-066a00250941',itemType:'product',name:'Vesta',archived:false,article:'A',code:'B',barcodes:['123'],characteristics:[]};
const db=(c,items=[])=>({prepare(sql){if(sql.includes('ms_assortment_current'))return {first:async()=>c};return {bind(...args){assert.equal(args[0],'g');return {all:async()=>({results:items.map(x=>({item_id:x.id,item_type:x.itemType,item_json:JSON.stringify(x)}))})};}};}});
test('unique barcode is evidence only',async()=>{
 const r=await catalogueCandidates(db(current,[item]),'123',now);assert.equal(r.status,'unique_candidate');assert.deepEqual(r.candidates[0].matchFields,['barcode']);assert.equal(r.automaticApproval,false);
});
test('missing or stale completed snapshot never resolves',async()=>{
 assert.equal(await catalogueCandidates(db(null),'A',now),null);assert.equal(await catalogueCandidates(db({...current,started_at:'2026-11-25T12:00:00Z'}),'A',now),null);
});
test('duplicates and archived products require review',async()=>{
 assert.equal((await catalogueCandidates(db(current,[item,{...item,id:'other'}]),'A',now)).status,'review');assert.equal((await catalogueCandidates(db(current,[{...item,archived:true}]),'B',now)).status,'review');
});
test('no match is not approval or stock evidence',async()=>{
 assert.equal((await catalogueCandidates(db(current),'X',now)).status,'no_exact_candidate');
});
