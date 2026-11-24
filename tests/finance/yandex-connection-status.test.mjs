import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../../functions/api/yandex/connection-status.js';
import {readFileSync} from 'node:fs';
test('Yandex status endpoint never discloses API key when auth is unavailable',async()=>{
 const x=await onRequestGet({request:new Request('https://example.com/api/yandex/connection-status'),env:{}});
 assert.equal(x.status,503);
 const data=await x.json();
 assert.equal(JSON.stringify(data).includes('YANDEX_MARKET_API_KEY'),false);
});
test('third-party Yandex token cannot be checked from IP company dashboard',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/yandex-connection-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/Отчёты стороннего ООО исключены/);
 assert.doesNotMatch(html,/id="yandexConnectionCheck"/);
 assert.doesNotMatch(html,/src="yandex-connection-ui\.mjs/);
 assert.match(js,/api\/yandex\/connection-status/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|method:'POST'|innerHTML/);
});
