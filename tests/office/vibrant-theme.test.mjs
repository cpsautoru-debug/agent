import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const html=get('web/office/index.html');
const css=get('web/office/office-vibrant-theme.css');
test('theme loads after existing office section styles and retains all section routes',()=>{
 const link='office-vibrant-theme.css?v=20261123';
 assert.ok(html.indexOf(link)>html.indexOf('/wb-unit-economics.css'));
 for(const name of ['dashboard','production','ozonProfit','wbFinance','orchestrator','connections'])
   assert.ok(html.includes('data-section="'+name+'"'),name);
 assert.match(html,/<meta name="theme-color" content="#252566">/);
});
test('dimensional styles are CSS-only and respect reduced-motion/mobile',()=>{
 for(const feature of ['.ceo-card','.ceo-source','.sidebar','.ceo-heading','radial-gradient','linear-gradient','box-shadow',
  '@media (prefers-reduced-motion:reduce)','@media(max-width:760px)'])
  assert.ok(css.includes(feature),feature);
 assert.doesNotMatch(css,/@import|url\(|!important.*display:none|visibility:hidden|content:\s*['"](?:0|verified)['"]/i);
 assert.match(css,/\.ceo-state\[data-state="warning"\]/);
 assert.match(css,/\.ceo-state\[data-state="success"\]/);
 assert.match(css,/transition:none!important/);
});
test('new theme does not change backend, finance computation, or permission contracts',()=>{
 assert.doesNotMatch(css,/fetch\(|api\/|token|password/i);
 assert.ok(!html.includes('src="office-vibrant-theme.css"'));
});
