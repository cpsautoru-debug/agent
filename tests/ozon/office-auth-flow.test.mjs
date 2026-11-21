import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

registerHooks({load(url,context,next){
  if(url.includes('/functions/api/auth/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {onRequestGet:start}=await import('../../functions/api/auth/google/start.js');
const {createGoogleCallbackHandler}=await import('../../functions/api/auth/google/callback.js');
const {onRequestGet:me}=await import('../../functions/api/auth/me.js');
const {safeOfficeReturn}=await import('../../functions/api/auth/google/return.js');
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const env={
  GOOGLE_CLIENT_ID:'test-google-client',
  GOOGLE_CLIENT_SECRET:'test-google-secret',
  OFFICE_SESSION_SECRET:'synthetic-secret-with-sufficient-length',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  OZON_FINANCE_DB:{
    prepare(sql){
      if(sql.includes('office_authorized_users')){
        return {
          async first(){return {google_sub:'google-owner-id'};},
          bind(sub,email){
            assert.equal(sub,'google-owner-id');
            assert.equal(email,'owner@example.invalid');
            return {async first(){return {role:'owner'};}};
          }
        };
      }
      if(sql.includes('office_pending_users')){
        return {bind(){return{async run(){return{success:true};}};}};
      }
      throw Error('Unexpected database query');
    }
  }
};
const cookies=response=>response.headers.getSetCookie();
const cookieValue=(cookie,name)=>{
  const match=cookie.match(new RegExp('^'+name+'=([^;]+)'));
  return match?.[1]||null;
};
const testCallback=createGoogleCallbackHandler({
  fetcher:async(url,options)=>{
    assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(options.method,'POST');
    assert.equal(options.body.get('code_verifier')?.length,43);
    return Response.json({id_token:'synthetic-valid-id-token'});
  },
  verifyIdentity:async(token,clientId)=>{
    assert.equal(token,'synthetic-valid-id-token');
    assert.equal(clientId,env.GOOGLE_CLIENT_ID);
    return {sub:'google-owner-id',email:'owner@example.invalid'};
  }
});
async function begin(next='production'){
  const response=await start({
    request:new Request(ORIGIN+'/api/auth/google/start?next='+encodeURIComponent(next)),
    env
  });
  const set=cookies(response);
  const values=Object.fromEntries(['oauth_state','oauth_verifier','oauth_return']
    .map(name=>[name,set.map(line=>cookieValue(line,name)).find(Boolean)]));
  return {response,values,headers:{Cookie:Object.entries(values).map(([key,value])=>key+'='+value).join('; ')}};
}

test('Google start keeps only an allowed office destination in HttpOnly cookie',async()=>{
  const {response,values}=await begin('production');
  assert.equal(response.status,302);
  assert.equal(values.oauth_return,'production');
  assert.match(values.oauth_state,/^[A-Za-z0-9_-]{43}$/);
  assert.match(values.oauth_verifier,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(cookies(response).length,3);
  for(const line of cookies(response))assert.match(line,/HttpOnly; Secure; SameSite=Lax/);
  const google=new URL(response.headers.get('Location'));
  assert.equal(google.origin,'https://accounts.google.com');
  assert.equal(google.searchParams.get('state'),values.oauth_state);
  assert.equal(google.searchParams.get('code_challenge_method'),'S256');
  for(const invalid of ['https://evil.invalid','//evil.invalid','production?redirect=evil','%2f%2fevil','']) {
    assert.equal(safeOfficeReturn(invalid),'overview');
    const other=await begin(invalid);
    assert.equal(other.values.oauth_return,'overview');
  }
});

test('successful owner login redirects to requested office section, sets ONE session cookie',async()=>{
  const {values,headers}=await begin('production');
  const request=new Request(ORIGIN+'/api/auth/google/callback?code=synthetic&state='+values.oauth_state,{
    headers
  });
  const response=await testCallback({request,env});
  assert.equal(response.status,303);
  assert.equal(response.headers.get('Location'),ORIGIN+'/#production');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(await response.text(),'');
  const set=cookies(response);
  assert.equal(set.filter(line=>line.startsWith('__Host-office_session=')).length,1);
  assert.equal(set.length,4);
  assert.ok(set.some(line=>line.startsWith('oauth_return=; Max-Age=0')));
  assert.ok(set.some(line=>line.startsWith('oauth_state=; Max-Age=0')));
  assert.ok(set.some(line=>line.startsWith('oauth_verifier=; Max-Age=0')));
  const session=set.find(line=>line.startsWith('__Host-office_session=')).split(';')[0];
  const identity=await me({request:new Request(ORIGIN+'/api/auth/me',{
    headers:{Cookie:session}
  }),env});
  assert.equal(identity.status,200);
  assert.deepEqual(await identity.json(),{authenticated:true,role:'owner'});
});

test('a missing or forged state cannot mint session, Google verification remains required',async()=>{
  const {values,headers}=await begin('ozonFinance');
  const badRequest=new Request(ORIGIN+'/api/auth/google/callback?code=x&state=forged',{
    headers
  });
  const bad=await testCallback({request:badRequest,env});
  assert.equal(bad.status,400);
  assert.equal(cookies(bad).filter(x=>x.startsWith('__Host-office_session=')).length,0);
  const other=await testCallback({
    request:new Request(ORIGIN+'/api/auth/google/callback?code=x&state='+values.oauth_state,
      {headers:{Cookie:headers.Cookie.replace('oauth_state='+values.oauth_state,'oauth_state=bad')}}),
    env
  });
  assert.equal(other.status,400);
  const notOwner=createGoogleCallbackHandler({
    fetcher:async()=>Response.json({id_token:'valid'}),
    verifyIdentity:async()=>({sub:'other-id',email:'other@example.invalid'})
  });
  const denied=await notOwner({request:new Request(ORIGIN+'/api/auth/google/callback?code=x&state='+values.oauth_state,{headers}),env});
  assert.equal(denied.status,403);
  assert.equal(cookies(denied).filter(x=>x.startsWith('__Host-office_session=')).length,0);
});

test('callback with invalid return destination can only redirect to overview',async()=>{
  const {values,headers}=await begin('https://evil.invalid');
  const response=await testCallback({request:new Request(
    ORIGIN+'/api/auth/google/callback?code=synthetic&state='+values.oauth_state,{headers}),env
  });
  assert.equal(response.status,303);
  assert.equal(response.headers.get('Location'),ORIGIN+'/#overview');
});
