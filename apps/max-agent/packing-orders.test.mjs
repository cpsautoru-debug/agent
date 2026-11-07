import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packingTest} from './packing-test.mjs';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'packing-orders-'));
 const env={MAX_OWNER_ID:'123',MAX_PACKING_TEST_ENABLED:'true',MAX_PACKING_TEST_DIR:dir};let n=0;
 const event=(command,mid=String(++n))=>({update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog'},body:{mid,text:'/test orders'+(command?' '+command:'')}}});
 return {dir,env,event,run:command=>packingTest(event(command),env),state:()=>JSON.parse(readFileSync(join(dir,'packing-orders-v1.json'),'utf8')),close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('linked scenario isolates five positions, mixed products, shipments and one surplus',async()=>{
 const f=fixture();try{
  assert.match((await f.run('')).text,/TEST-OZ-1/);
  await f.run('role alexandra');
  const quantities=[['TEST-OZ-1',6],['TEST-OZ-2',3],['TEST-WB-1',3],['TEST-AV-1',2],['TEST-PL-1',2]];
  for(const [id,qty] of quantities)assert.match((await f.run(`produce ${id} ${qty} sew-${id}`)).text,/ОК/);
  await f.run('role irina');
  for(const [id,produced] of quantities){const qty=id==='TEST-OZ-1'?5:produced;await f.run(`pack ${id} ${qty} pack-${id}`);await f.run(`handover SHIP-1 ${id} ${qty} hand-${id}`);}
  await f.run('role dmitry');assert.match((await f.run('accept SHIP-1 accept-1')).text,/ОК/);
  const s=f.state();assert.equal(s.positions.reduce((n,p)=>n+p.produced,0),16);assert.equal(s.positions.reduce((n,p)=>n+p.accepted,0),15);
  assert.equal(s.positions[0].produced-s.positions[0].accepted,1);assert.equal(s.positions[1].category,'carpets');
  assert.equal(s.shipments['SHIP-1'].lines.length,5);assert.equal(s.shipments['SHIP-1'].status,'accepted');
  assert.equal(existsSync(join(f.dir,'packing-test-v1.json')),false);
 }finally{f.close();}
});
test('partial operations preserve per-position balance; IDs, roles, duplicates and transitions are enforced',async()=>{
 const f=fixture();const reject=async command=>assert.match((await f.run(command)).text,/ОТКАЗ/);
 try{
  await reject('pack TEST-OZ-1 1 p1');await f.run('role alexandra');await f.run('produce TEST-OZ-1 6 s1');
  await reject('produce TEST-OZ-1 6 s1');await reject('produce TEST-WB-1 1 s1');await reject('produce UNKNOWN 1 x');
  await f.run('role irina');await reject('pack TEST-OZ-2 1 p0');await reject('pack TEST-OZ-1 6 p0');
  await reject('pack TEST-WB-1 1 p0');
  await reject('pack TEST-OZ-1 1.5 p0');await reject('pack TEST-OZ-1 -1 p0');await reject('pack TEST-OZ-1 0 p0');
  await f.run('pack TEST-OZ-1 2 p1');await reject('pack TEST-OZ-1 2 p1');await reject('handover SHIP-1 TEST-OZ-1 3 h0');
  await f.run('handover SHIP-1 TEST-OZ-1 2 h1');await reject('handover SHIP-1 TEST-OZ-1 2 h2');
  await reject('accept SHIP-1 a0');await f.run('role dmitry');await reject('accept UNKNOWN a0');
  await f.run('accept SHIP-1 a1');await reject('accept SHIP-1 a2');
  await f.run('role irina');await f.run('pack TEST-OZ-1 3 p2');await reject('handover SHIP-1 TEST-OZ-1 1 h3');
  await f.run('handover SHIP-2 TEST-OZ-1 3 h4');await f.run('role dmitry');await f.run('accept SHIP-2 a3');
  assert.equal(f.state().positions[0].accepted,5);assert.equal(f.state().positions[1].accepted,0);
  const e=f.event('status','stable');assert.deepEqual(await packingTest(e,f.env),await packingTest(e,f.env));
  const s=f.state();assert.equal(new Set(s.journal.map(x=>x.id)).size,s.journal.length);
  assert.match((await f.run('status TEST-OZ-1')).text,/Списание: 0/);
  const accepted=s.positions[0].accepted;
  await f.run('личные сведения не должны попасть в журнал');
  assert.equal(JSON.stringify(f.state()).includes('личные сведения'),false);assert.equal(f.state().positions[0].accepted,accepted);
 }finally{f.close();}
});
test('orders namespace cannot bypass access; corrupt state and busy locks fail closed',async()=>{
 const f=fixture();try{
  const e=f.event('');e.message.sender.user_id=456;assert.deepEqual(await packingTest(e,f.env),{ignored:true});assert.equal(existsSync(join(f.dir,'packing-orders-v1.json')),false);
  await f.run('');const file=join(f.dir,'packing-orders-v1.json'),s=f.state();s.positions[0].accepted=100;writeFileSync(file,JSON.stringify(s));
  await assert.rejects(f.run('status'));assert.equal(f.state().positions[0].accepted,100);
 }finally{f.close();}
});
test('busy order storage stays retryable without touching legacy scenario',async()=>{
 const f=fixture();try{
  await packingTest({...f.event(''),message:{...f.event('').message,body:{text:'/test',mid:'legacy'}}},f.env);
  const legacy=readFileSync(join(f.dir,'packing-test-v1.json'),'utf8');
  writeFileSync(join(f.dir,'packing-orders-v1.lock'),'busy');
  await assert.rejects(f.run(''));assert.equal(existsSync(join(f.dir,'packing-orders-v1.json')),false);
  assert.equal(readFileSync(join(f.dir,'packing-test-v1.json'),'utf8'),legacy);
 }finally{f.close();}
});
