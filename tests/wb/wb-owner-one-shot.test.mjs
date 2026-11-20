import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const { createOwnerSyncHandler } = await import('../../functions/api/wb/sync-once.js');
const { createSession } = await import('../../functions/api/auth/session.js');
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const env={
  OFFICE_SESSION_SECRET:'synthetic-secret-123',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  WB_REPORT_ACCOUNT_ID:'4271851',
  WB_REPORT_SAVE_MODE:'test-only',
  WB_API_TOKEN:'synthetic-not-real',
  WB_REPORT_SNAPSHOT_DB:{},
  OZON_FINANCE_DB:{
    prepare(sql){assert.match(sql,/office_authorized_users/);return {
      bind(sub,email){assert.equal(email,'owner@example.invalid');return {
        async first(){return sub==='owner-id'?{allowed:1}:null;}
      };}
    };}
  }
};
async function request(sub='owner-id',origin=ORIGIN){
  const headers={Origin:origin,'Content-Type':'application/json','X-WB-One-Shot':'owner-20261120'};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(ORIGIN+'/api/wb/sync-once',{method:'POST',headers,body:'{}'});
}
test('owner triggers exactly one sync call with existing server secret and no token leakage',async()=>{
  let count=0;
  const handler=createOwnerSyncHandler(async value=>{
    count++;
    assert.equal(value.WB_FINANCE_AUTO_SYNC,'enabled');
    assert.equal(value.WB_API_TOKEN,'synthetic-not-real');
    return 'discovered_10';
  });
  const result=await handler({request:await request(),env});
  assert.equal(result.status,200);
  assert.equal(count,1);
  const output=await result.text();
  assert.match(output,/discovered_10/);
  assert.doesNotMatch(output,/synthetic-not-real/);
  assert.match(output,/"cronEnabled":false/);
});
test('unauthorized and invalid Origin never invoke syncing or D1 writes',async()=>{
  let count=0;
  const handler=createOwnerSyncHandler(async()=>{count++;return 'incorrect';});
  for(const [sub,origin,status] of [
    [null,ORIGIN,401],['staff-id',ORIGIN,403],['owner-id','https://wrong.invalid',403]
  ]) {
    const r=await handler({request:await request(sub,origin),env});
    assert.equal(r.status,status);
  }
  assert.equal(count,0);
});
test('disabled staging access or absent Finance secret fails closed',async()=>{
  let count=0;
  const handler=createOwnerSyncHandler(async()=>{count++;return 'incorrect';});
  for(const broken of [{...env,WB_REPORT_SAVE_MODE:'production'},{...env,WB_API_TOKEN:''}]) {
    const r=await handler({request:await request(),env:broken});
    assert.equal(r.status,503);
  }
  assert.equal(count,0);
});
