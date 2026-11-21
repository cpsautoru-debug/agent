import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {summarizeWbFinance} from '../../web/office/wb-finance-monitor-core.mjs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../../web/office/wb-auto-sync-status.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../../web/office/wb-finance-monitor.css',import.meta.url),'utf8');
const NOW=Date.UTC(2026,10,21,5,26);
const report=(i,status='complete')=>({
  report_id:String(860000000+i),date_from:'2026-10-01',date_to:'2026-10-07',
  report_type:1,bank_payment_kop:10000+i,status,
  row_count:status==='complete'?112:0,
  sales_count:status==='complete'?100:0,
  returns_count:status==='complete'?1:0,
  api_calculated_payment_kop:status==='complete'?10000+i:null,
  error_code:'',updated_at:'2026-11-21 05:25:06'
});
const runtime=(status='report_complete')=>({
  last_status:status,last_request_ms:NOW-60_000,
  last_list_day:'2026-11-21',list_offset:0,updated_at:'2026-11-21 05:25:06'
});
const normal=summarizeWbFinance(runtime(),[
  ...Array.from({length:9},(_,i)=>report(i)),
  ...Array.from({length:7},(_,i)=>report(i+9,'pending'))
],1008,NOW);
function harness(payload=normal,{hash='#wbFinance',http=200}={}){
  const ids=['wbAutoSyncPanel','wbAutoSyncRefresh','wbAutoSyncStatus',
    'wbAutoSyncRows','wbMonitorQueueRows','wbMonitorIssueRows',
    'wbMonitorWarnings','wbMonitorFilter','wbMonitorHealth',
    'wbMonitorReports','wbMonitorComplete','wbMonitorQueue',
    'wbMonitorIssues','wbMonitorOperations','wbMonitorPercent',
    'wbMonitorProgress','wbMonitorLastRequest','wbMonitorLastChange',
    'wbMonitorPayout','wbMonitorWindow','wbMonitorQueueCount',
    'wbMonitorIssuesCount','wbMonitorAllCount'];
  const element=(id='')=>({
    id,textContent:'',children:[],value:id==='wbMonitorFilter'?'all':0,
    disabled:false,events:{},className:'',
    addEventListener(name,fn){this.events[name]=fn;},
    append(child){this.children.push(child);},
    replaceChildren(){this.children=[];}
  });
  const els=new Map(ids.map(id=>[id,element(id)]));
  const docEvents={},winEvents={},calls=[];
  const location={hash};
  let response=payload,status=http;
  const fetch=async(url,options)=>{
    calls.push({url,options});
    assert.equal(url,'/api/wb/auto-sync-status');
    assert.equal(options.method,'GET');
    assert.equal(options.credentials,'same-origin');
    assert.equal(options.cache,'no-store');
    return {status,ok:status===200,async json(){return response;}};
  };
  const context={
    document:{
      visibilityState:'visible',
      getElementById(id){return els.get(id)||null;},
      createElement(){return element();},
      addEventListener(name,fn){docEvents[name]=fn;}
    },
    window:{
      addEventListener(name,fn){winEvents[name]=fn;},
      setInterval(fn,ms){assert.equal(ms,60*1000);winEvents.tick=fn;}
    },
    location,fetch,Intl,Date,Math,Number,Promise,Error,Array,
    Object,RegExp,Set,
    AbortSignal:{timeout:()=>undefined}
  };
  runInNewContext(script,context);
  return {els,location,calls,docEvents,winEvents,
    respond(next,nextStatus=200){response=next;status=nextStatus;}
  };
}
async function flush(){
  for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
}
test('main WB office monitor exists once and old manual-Cron-disabled claim is gone',()=>{
  const ids=['wbAutoSyncPanel','wbMonitorHealth','wbMonitorReports',
    'wbMonitorComplete','wbMonitorQueue','wbMonitorIssues',
    'wbMonitorOperations','wbMonitorQueueRows','wbMonitorIssueRows',
    'wbMonitorWarnings','wbMonitorFilter','wbAutoSyncRows','wbAutoSyncRefresh'];
  for(const id of ids)
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/Финансовый монитор Wildberries/);
  assert.match(html,/08:00–10:55/);
  assert.doesNotMatch(html,/Cron выключен/);
  assert.doesNotMatch(html,/id="wbAutoSyncStepButton"/);
  assert.match(html,/\/wb-auto-sync-status\.js\?v=20261121-full-monitor/);
  assert.match(html,/wb-finance-monitor\.css/);
  assert.match(styles,/\.wb-monitor-metrics/);
  assert.doesNotMatch(script,/fetch\(['"]\/api\/wb\/sync-once/);
  assert.doesNotMatch(script,/method:'POST'|localStorage|sessionStorage|innerHTML/);
});
test('visible WB section automatically renders 9 complete, 7 pending, 1008 operations',async()=>{
  const app=harness();
  await flush();
  assert.equal(app.calls.length,1);
  assert.equal(app.els.get('wbMonitorReports').textContent,'16');
  assert.equal(app.els.get('wbMonitorComplete').textContent,'9');
  assert.equal(app.els.get('wbMonitorQueue').textContent,'7');
  assert.equal(app.els.get('wbMonitorOperations').textContent,'1 008'.replaceAll(' ',' '));
  assert.equal(app.els.get('wbMonitorHealth').textContent,'По расписанию');
  assert.equal(app.els.get('wbMonitorProgress').value,56);
  assert.equal(app.els.get('wbMonitorQueueRows').children.length,7);
  assert.equal(app.els.get('wbMonitorIssueRows').children.length,1);
  assert.equal(app.els.get('wbAutoSyncRows').children.length,16);
  assert.match(app.els.get('wbMonitorPayout').textContent,/9 завершённым/);
  assert.doesNotMatch(app.els.get('wbMonitorPayout').textContent,/чистая прибыль:/);
});
test('hidden WB section reads no D1; entering section loads just one read',async()=>{
  const app=harness(normal,{hash:'#production'});
  await flush();
  assert.equal(app.calls.length,0);
  app.location.hash='#wbFinance';
  app.winEvents.hashchange();
  await flush();
  assert.equal(app.calls.length,1);
  app.winEvents.tick();
  await flush();
  assert.equal(app.calls.length,1);
  await app.els.get('wbAutoSyncRefresh').events.click();
  await flush();
  assert.equal(app.calls.length,2);
  app.els.get('wbMonitorFilter').value='pending';
  app.els.get('wbMonitorFilter').events.change();
  assert.equal(app.els.get('wbAutoSyncRows').children.length,7);
});
test('halted, mismatches and source conflicts display errors with no financial mutation',async()=>{
  const alert=summarizeWbFinance(runtime('halted_report_rate_limited'),[
    {...report(1,'mismatch'),api_calculated_payment_kop:8000,
      error_code:'payout_needs_review'},
    {...report(2,'conflict'),error_code:'api_operation_changed'},
    report(3,'pending')
  ],0,NOW);
  const app=harness(alert);
  await flush();
  assert.equal(app.els.get('wbMonitorHealth').textContent,'Синхронизация остановлена');
  assert.equal(app.els.get('wbMonitorIssues').textContent,'2');
  assert.equal(app.els.get('wbMonitorIssueRows').children.length,2);
  assert.equal(app.els.get('wbMonitorWarnings').children.length,3);
  assert.match(app.els.get('wbAutoSyncStatus').textContent,/Нужна проверка/);
});
test('a failed owner-only API read clears previously displayed financial figures',async()=>{
  const app=harness(normal);
  await flush();
  assert.equal(app.els.get('wbMonitorReports').textContent,'16');
  app.respond({code:'configuration_unavailable'},503);
  await app.els.get('wbAutoSyncRefresh').events.click();
  await flush();
  assert.equal(app.els.get('wbMonitorReports').textContent,'—');
  assert.equal(app.els.get('wbAutoSyncRows').children.length,0);
  assert.match(app.els.get('wbAutoSyncStatus').textContent,/Статус WB временно не подтверждён/);
});
