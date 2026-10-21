import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,appendFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeDocument} from './audit-ledger.mjs';
const doc={accountId:'00000000-0000-0000-0000-000000000001',type:'move',documentId:'00000000-0000-0000-0000-000000000002',hash:'a'.repeat(64),applied:true};
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'autosklad-audit-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('audit observations survive reopening, repeats do not append and changed hashes require review',async t=>{
 const dir=await directory(t);assert.equal((await observeDocument(dir,doc)).state,'new-needs-review');
 const before=await readFile(join(dir,'observations.jsonl'),'utf8');
 assert.equal((await observeDocument(dir,{...doc})).state,'already-observed');
 assert.equal(await readFile(join(dir,'observations.jsonl'),'utf8'),before);
 const changed=await observeDocument(dir,{...doc,hash:'b'.repeat(64)});assert.equal(changed.state,'changed-needs-review');assert.deepEqual(changed.writeOperations,[]);
 assert.equal((await observeDocument(dir,{...doc,hash:'b'.repeat(64)})).state,'already-observed');
});
test('parallel observers never append the same observation twice',async t=>{
 const dir=await directory(t);const results=await Promise.allSettled([observeDocument(dir,doc),observeDocument(dir,doc)]);
 assert.ok(results.some(x=>x.status==='fulfilled'));assert.ok(results.every(x=>x.status==='fulfilled'||x.reason.message==='audit-ledger-busy'));
 const lines=(await readFile(join(dir,'observations.jsonl'),'utf8')).trim().split('\n');assert.equal(lines.length,1);
});
test('corrupt or partial journal fails closed and preserves evidence',async t=>{
 const dir=await directory(t);await observeDocument(dir,doc);await appendFile(join(dir,'observations.jsonl'),'{incomplete');
 const before=await readFile(join(dir,'observations.jsonl'),'utf8');await assert.rejects(()=>observeDocument(dir,{...doc,hash:'b'.repeat(64)}),/audit-ledger-corrupt/);
 assert.equal(await readFile(join(dir,'observations.jsonl'),'utf8'),before);
});
test('journal rejects unknown fields and stores no business document content',async t=>{
 const dir=await directory(t);await assert.rejects(()=>observeDocument(dir,{...doc,token:'secret'}),/invalid-observation/);
 await assert.rejects(()=>observeDocument(dir,{...doc,documentId:'invalid'}),/invalid-observation/);
 await observeDocument(dir,doc);const raw=await readFile(join(dir,'observations.jsonl'),'utf8');assert.ok(!raw.includes('secret'));assert.ok(!raw.includes('processed'));assert.equal(JSON.parse(raw).schema,1);
});
test('JSON-valid schema corruption fails closed without appending',async t=>{
 const dir=await directory(t);await observeDocument(dir,doc);
 const file=join(dir,'observations.jsonl');const valid=JSON.parse(await readFile(file,'utf8'));
 for(const invalid of [{...valid,updated:{}},{...valid,observedAt:null},{...valid,token:'not-allowed'}]){
  const raw=JSON.stringify(invalid)+'\n';await writeFile(file,raw);
  await assert.rejects(()=>observeDocument(dir,{...doc,hash:'b'.repeat(64)}),/audit-ledger-corrupt/);
  assert.equal(await readFile(file,'utf8'),raw);
 }
});
test('a full journal still allows exact repeats but rejects another append',async t=>{
 const dir=await directory(t);await observeDocument(dir,doc);const file=join(dir,'observations.jsonl'),row=JSON.parse(await readFile(file,'utf8'));
 await writeFile(file,Array.from({length:10000},(_,i)=>JSON.stringify({...row,seq:i+1})).join('\n')+'\n');
 const before=await readFile(file,'utf8');assert.equal((await observeDocument(dir,doc)).state,'already-observed');
 await assert.rejects(()=>observeDocument(dir,{...doc,hash:'b'.repeat(64)}),/audit-ledger-full/);assert.equal(await readFile(file,'utf8'),before);
});
