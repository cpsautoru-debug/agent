import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPreviewOrigin,verifyProductionPreview} from '../../scripts/ms-preview-smoke.mjs';

const preview='https://feature-ms-full-coverage-probe-20261120.autosklad63-office-staging.pages.dev/';
const assetHeaders={'Content-Type':'application/javascript; charset=utf-8'};
const htmlHeaders={'Content-Type':'text/html; charset=utf-8'};
const apiHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'};
const html='<html><button id="msCoverageProbeStart"></button><script src="ms-production-coverage-probe.mjs"></script></html>';
function mock(path){
  if(path==='/')return new Response(html,{status:200,headers:htmlHeaders});
  if(path==='/ms-production-coverage-probe.mjs')return new Response("export const id='msCoverageProbeStart';",{status:200,headers:assetHeaders});
  if(path==='/ms-production-scan-budget.mjs')return new Response('export const estimate=()=>1;',{status:200,headers:assetHeaders});
  if(path==='/api/ms/production-coverage-probe')
    return new Response(JSON.stringify({code:'owner_session_required'}),{status:401,headers:apiHeaders});
  throw Error('unexpected_path');
}

test('preview URL rejects live staging, hostile lookalikes and non-HTTPS',()=>{
  assert.equal(assertPreviewOrigin(preview),preview.slice(0,-1));
  for(const candidate of [
    'https://autosklad63-office-staging.pages.dev/',
    'https://feature.autosklad63-office-staging.pages.dev.attacker.net/',
    'http://feature.autosklad63-office-staging.pages.dev/',
    'https://user:pass@feature.autosklad63-office-staging.pages.dev/',
    preview+'?token=x',
    'not-a-url'
  ])assert.throws(()=>assertPreviewOrigin(candidate),candidate);
});

test('smoke checks exactly three static resources and anonymous owner-only API via GET',async()=>{
  const calls=[];
  const result=await verifyProductionPreview(preview,async(url,options)=>{
    calls.push({path:new URL(url).pathname,options});
    return mock(new URL(url).pathname);
  });
  assert.equal(result.code,'ms_preview_smoke_ok');
  assert.equal(result.changedRecords,0);
  assert.equal(result.liveOwnerProbeExecuted,false);
  assert.deepEqual(result.steps,['html_ready','asset_ready','asset_ready','owner_only_guard_ready']);
  assert.deepEqual(calls.map(x=>x.path),[
    '/','/ms-production-coverage-probe.mjs','/ms-production-scan-budget.mjs',
    '/api/ms/production-coverage-probe'
  ]);
  for(const call of calls){
    assert.equal(call.options.method,'GET');
    assert.equal(call.options.credentials,'omit');
    assert.equal(call.options.redirect,'manual');
    assert.equal(call.options.cache,'no-store');
    assert.ok(!('Authorization' in call.options.headers));
    assert.ok(!('Cookie' in call.options.headers));
  }
});

test('SPA HTML fallback for JS or API never counts as deployed',async()=>{
  await assert.rejects(
    verifyProductionPreview(preview,async(url)=>{
      const path=new URL(url).pathname;
      return path==='/ms-production-coverage-probe.mjs'?
        new Response(html,{status:200,headers:htmlHeaders}):mock(path);
    }),/preview_js_not_ready/
  );
  await assert.rejects(
    verifyProductionPreview(preview,async(url)=>{
      const path=new URL(url).pathname;
      return path==='/api/ms/production-coverage-probe'?
        new Response(html,{status:200,headers:htmlHeaders}):mock(path);
    }),/preview_auth_guard_not_ready/
  );
});

test('missing bindings, exposed endpoint or absent no-store header fails closed',async()=>{
  for(const invalidResponse of [
    new Response(JSON.stringify({code:'owner_auth_unavailable'}),{status:503,headers:apiHeaders}),
    new Response(JSON.stringify({code:'ms_production_coverage_probe_ok'}),{status:200,headers:apiHeaders}),
    new Response(JSON.stringify({code:'owner_session_required'}),{status:401,headers:{'Content-Type':'application/json'}})
  ]){
    await assert.rejects(
      verifyProductionPreview(preview,async url=>{
        const path=new URL(url).pathname;
        return path==='/api/ms/production-coverage-probe'?invalidResponse.clone():mock(path);
      }),/preview_auth_guard_not_ready/
    );
  }
});

test('never executes requests when preview URL is not a valid alias',async()=>{
  let called=0;
  await assert.rejects(
    verifyProductionPreview('https://autosklad63-office-staging.pages.dev/',async()=>{called++;}),
    /preview_origin_required/
  );
  assert.equal(called,0);
});
