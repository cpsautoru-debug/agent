import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {queryBot,makeServer,EXPECTED_BOT} from './server.mjs';
function fake(data,status=200){return (url,options,cb)=>{
  assert.equal(url,'https://platform-api2.max.ru/me');assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.ca.length,2);assert.equal(options.headers.Authorization,'secret');
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};
  req.end=()=>{const res=new EventEmitter();res.statusCode=status;res.setEncoding=()=>{};res.destroy=()=>{};cb(res);res.emit('data',JSON.stringify(data));res.emit('end');};return req;
};}
test('only approved bot is accepted and upstream private fields are not returned',async()=>{
  const result=await queryBot('secret',fake({username:EXPECTED_BOT,is_bot:true,token:'secret',user_id:123}));assert.equal(result.connected,true);assert.doesNotMatch(JSON.stringify(result),/secret|123/);
  assert.equal((await queryBot('secret',fake({username:'other',is_bot:true}))).connected,false);
  assert.equal((await queryBot('secret',fake({error:'secret'},401))).http,401);
});
test('certificate files are CA certificates and valid today',()=>{
  for(const name of ['russian-root.crt','russian-sub.crt']){
    const cert=new X509Certificate(readFileSync(new URL('./certs/'+name,import.meta.url)));
    assert.equal(cert.ca,true);assert.ok(new Date(cert.validFrom)<=new Date());assert.ok(new Date(cert.validTo)>new Date());
  }
});
test('public health does not call MAX; connection checks are cached and cannot write',async()=>{
  let count=0;const server=makeServer({MAX_BOT_TOKEN:'secret'},async()=>{count++;return {connected:true,username:EXPECTED_BOT};});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    const health=await (await fetch(base+'/health')).json();assert.equal(health.sheetsWrite,false);assert.equal(count,0);
    const values=await Promise.all([fetch(base+'/api/connection').then(r=>r.json()),fetch(base+'/api/connection').then(r=>r.json())]);
    assert.equal(count,1);assert.equal(values[0].connected,true);assert.equal(values[1].orderIntake,false);
    assert.equal((await fetch(base+'/api/connection',{method:'POST'})).status,405);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
