import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
const dataModule = text => 'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const modelUrl=dataModule(await readFile(new URL('../../functions/api/ozon/profit-model.js',import.meta.url),'utf8'));
const storeText=(await readFile(new URL('../../workers/ozon-profit-store.js',import.meta.url),'utf8')).replace("'../functions/api/ozon/profit-model.js'",JSON.stringify(modelUrl));
const {getProfitDocument,confirmProfitDocument,getProfitDocuments,TEST_PROFIT_DATABASE_ID}=await import(dataModule(storeText));
const {createProfitPreview,verifyProfitPreview}=await import(dataModule(await readFile(new URL('../../functions/api/ozon/profit-preview.js',import.meta.url),'utf8')));

const migration = await readFile(new URL('../../migrations/0004_ozon_profit.sql',import.meta.url),'utf8');
function db() {
 const sql = new DatabaseSync(':memory:'); sql.exec(migration); sql.exec(migration);
 return {sql,prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}})}},first:async()=>sql.prepare(query).get()||null,all:async()=>({results:sql.prepare(query).all()})}}};
}
const cost = {entries:[{sku:'synthetic-sku',costKopecks:100,validFrom:'2026-10-01',validTo:null,status:'confirmed',source:'synthetic owner evidence',leatherDeliveryIncluded:false}]};
test('preview is stateless and rejects tampering, another owner, another payload and expiry',async()=>{
 const database=db(); const before=await getProfitDocument(database,TEST_PROFIT_DATABASE_ID,'costs');
 const preview=await createProfitPreview('secret','owner','costs',cost,before,1000);
 assert.equal(database.sql.prepare('SELECT count(*) n FROM ozon_profit_audit').get().n,0);
 assert.equal((await verifyProfitPreview('secret','owner','costs',cost,preview.token,1001)).version,0);
 await assert.rejects(verifyProfitPreview('secret','other','costs',cost,preview.token,1001));
 await assert.rejects(verifyProfitPreview('secret','owner','expenses',cost,preview.token,1001));
 await assert.rejects(verifyProfitPreview('secret','owner','costs',{entries:[]},preview.token,1001));
 await assert.rejects(verifyProfitPreview('secret','owner','costs',cost,preview.token+'x',1001));
 await assert.rejects(verifyProfitPreview('secret','owner','costs',cost,preview.token,1000+600001));
 database.sql.close();
});
test('CAS confirmation writes one immutable audit, stale and replayed previews cannot overwrite',async()=>{
 const database=db();
 const first=await confirmProfitDocument(database,TEST_PROFIT_DATABASE_ID,{key:'costs',value:cost,version:0,actor:'owner',changeId:'first-change'});
 assert.equal(first.version,1);
 await assert.rejects(confirmProfitDocument(database,TEST_PROFIT_DATABASE_ID,{key:'costs',value:cost,version:0,actor:'owner',changeId:'first-change'}),/conflict/);
 const next={entries:[{...cost.entries[0],costKopecks:200}]};
 await confirmProfitDocument(database,TEST_PROFIT_DATABASE_ID,{key:'costs',value:next,version:1,actor:'owner',changeId:'second-change'});
 assert.equal((await getProfitDocument(database,TEST_PROFIT_DATABASE_ID,'costs')).value.entries[0].costKopecks,200);
 const audit=database.sql.prepare('SELECT * FROM ozon_profit_audit ORDER BY version').all();
 assert.equal(audit.length,2); assert.equal(JSON.parse(audit[1].before_json).entries[0].costKopecks,100);
 assert.equal(JSON.parse(audit[1].after_json).entries[0].costKopecks,200);
 assert.throws(()=>database.sql.prepare('UPDATE ozon_profit_audit SET actor=?').run('tamper'),/immutable/);
 assert.throws(()=>database.sql.prepare('DELETE FROM ozon_profit_audit').run(),/immutable/);
 database.sql.close();
});
test('profit operations reject wrong target before changing anything',async()=>{
 const database=db();
 await assert.rejects(getProfitDocument(database,'main-database','costs'),/target/);
 await assert.rejects(confirmProfitDocument(database,'main-database',{key:'costs',value:cost,version:0,actor:'owner',changeId:'x'}),/target/);
 assert.equal(database.sql.prepare('SELECT count(*) n FROM ozon_profit_state').get().n,0);
 const result=await getProfitDocuments(database,TEST_PROFIT_DATABASE_ID,'2026-10');
 assert.equal(result.configuration.month,null);assert.equal(result.versions.costs,0);
 database.sql.close();
});
test('audit trigger failure rolls back document change atomically',async()=>{
 const database=db();
 await confirmProfitDocument(database,TEST_PROFIT_DATABASE_ID,{key:'costs',value:cost,version:0,actor:'owner',changeId:'unique-id'});
 await assert.rejects(confirmProfitDocument(database,TEST_PROFIT_DATABASE_ID,{key:'costs',value:{entries:[]},version:1,actor:'owner',changeId:'unique-id'}));
 assert.equal((await getProfitDocument(database,TEST_PROFIT_DATABASE_ID,'costs')).version,1);
 assert.equal((await getProfitDocument(database,TEST_PROFIT_DATABASE_ID,'costs')).value.entries.length,1);
 database.sql.close();
});
