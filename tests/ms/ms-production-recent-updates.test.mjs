import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {parseProductionFeedScope,buildProductionFeedUrl,summarizeProductionFeed}=
  await import('../../functions/api/ms/production-feed.js');
const root=new URL('../../web/office/',import.meta.url);
test('read-only API supports latest updates without typed task numbers',()=>{
  const url=new URL('https://autosklad63-office-staging.pages.dev/api/ms/production-feed?sort=updated');
  const scope=parseProductionFeedScope(url);
  assert.deepEqual(scope,{offset:0,number:null,sort:'updated'});
  const upstream=new URL(buildProductionFeedUrl(scope));
  assert.equal(upstream.searchParams.get('order'),'updated,desc');
  assert.equal(upstream.searchParams.get('limit'),'5');
  assert.equal(upstream.searchParams.has('filter'),false);
  const result=summarizeProductionFeed({meta:{size:8},rows:[{
    name:'00740',moment:'2026-11-20 08:00:00.000',
    updated:'2026-11-22 08:00:00.000'
  }]},scope);
  assert.equal(result.selection,'LATEST_5_BY_UPDATE_NOT_ACTIVE_TASKS');
  assert.equal(result.readOnly,true);
  assert.equal(result.changedRecords,0);
});
test('view has auto recent updates by default and old date sorting available',()=>{
  const html=readFileSync(new URL('index.html',root),'utf8');
  const js=readFileSync(new URL('ms-production.js',root),'utf8');
  assert.match(html,/id="msProductionSort"/);
  assert.match(html,/option value="updated" selected/);
  assert.match(html,/option value="moment"/);
  assert.match(html,/ms-production\.js\?v=20261122-recent/);
  assert.match(js,/let scope=\{offset:0,number:null,sort:'updated'\}/);
  assert.match(js,/search\.set\('sort','updated'\)/);
  assert.match(js,/LATEST_5_BY_UPDATE_NOT_ACTIVE_TASKS/);
  assert.match(js,/sortSelect\.addEventListener\('change'/);
  assert.doesNotMatch(js,/localStorage|sessionStorage/);
});
