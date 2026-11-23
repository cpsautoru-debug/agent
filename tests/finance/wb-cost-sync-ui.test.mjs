import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('WB owner sync UI requires a real button and does not write at page load',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const src=readFileSync(new URL('../../web/office/wb-cost-sync-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/id="wbCostSyncButton"/);
 assert.match(html,/id="wbCostSyncStatus"/);
 assert.match(src,/addEventListener\('click'/);
 assert.match(src,/method:'POST'/);
 assert.match(src,/code!=='wb_cost_registry_synchronized'/);
 assert.doesNotMatch(src,/localStorage|innerHTML/);
});
