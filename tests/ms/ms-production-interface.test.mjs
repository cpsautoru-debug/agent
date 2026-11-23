import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-production.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');

test('production page has one set of working controls and no Google Sheet dependency',()=>{
  const section=html.split('<!-- ПРОИЗВОДСТВО -->')[1]?.split('</section>\n\n    <footer>')[0];
  assert.ok(section,'Production page must exist');
  for(const id of [
    'msProductionRefresh','msProductionSearchForm','msProductionNumber',
    'msProductionReset','msProductionPrev','msProductionNext',
    'msProductionRows','msProductionStagePanel','msProductionStageRows',
    'msProductionStageRefresh','msStageRemaining'
  ])assert.equal((section.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.doesNotMatch(section,/docs\.google\.com\/spreadsheets/i);
  assert.match(html,/type="module" src="ms-production\.js(?:\?[^"]*)?"/);
  assert.match(html,/Контроль производства/);
});
test('visual progress and mobile layout are available',()=>{
  assert.match(js,/document\.createElement\('progress'\)/);
  assert.match(js,/Europe\/Samara/);
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/\.ms-production-search/);
});
test('browser refresh is limited to visible production tab and 10 minute interval',()=>{
  assert.match(js,/10\*60\*1000/);
  assert.match(js,/document\.visibilityState==='visible'/);
  assert.match(js,/setInterval\(autoRefresh,60\*1000\)/);
  assert.match(js,/stageRefresh\.addEventListener/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML/);
});
