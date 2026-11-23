import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateEntityTotal} from '../../web/office/entity-allocation.mjs';
const totalKopecks=20550700;
const base={totalKopecks,source:'Owner-confirmed FNS October AUSN charge',
 eligibleChannels:['ozon','wb','avito'],
 amounts:{ozon:100000,wb:100000,avito:100000}};
test('entity tax is assigned once and rounding preserves the exact legal total',()=>{
 const r=allocateEntityTotal(base);
 assert.equal(r.status,'allocated_management_only');
 assert.equal(r.allocatedTotalKopecks,totalKopecks);
 assert.equal(r.allocations.yandex,null);
 assert.equal(r.allocations.offline,null);
 assert.equal(r.allocations.ozon+r.allocations.wb+r.allocations.avito,totalKopecks);
 assert.ok(Math.max(r.allocations.ozon,r.allocations.wb,r.allocations.avito)-
 Math.min(r.allocations.ozon,r.allocations.wb,r.allocations.avito)<=1);
});
test('unknown channel income never becomes zero or a guessed ratio',()=>{
 const r=allocateEntityTotal({...base,amounts:{ozon:100000,wb:null,avito:100000}});
 assert.equal(r.status,'incomplete');
 assert.deepEqual(r.missingChannels,['wb']);
 assert.equal(r.allocations,null);
});
test('separate company channels are excluded from IP tax, not given a fake zero',()=>{
 const r=allocateEntityTotal({...base,eligibleChannels:['ozon','wb'],
 amounts:{ozon:750000,wb:250000,yandex:9000000}});
 assert.equal(r.allocations.yandex,null);
 assert.equal(r.allocations.ozon,15413025);
 assert.equal(r.allocations.wb,5137675);
});
test('cannot allocate zero income or unsafe totals',()=>{
 const r=allocateEntityTotal({...base,amounts:{ozon:0,wb:0,avito:0}});
 assert.equal(r.status,'incomplete');
 assert.throws(()=>allocateEntityTotal({...base,totalKopecks:1.2}));
 assert.throws(()=>allocateEntityTotal({...base,eligibleChannels:['ozon','ozon']}));
 assert.throws(()=>allocateEntityTotal({...base,amounts:{ozon:-100,wb:10,avito:10}}));
});
