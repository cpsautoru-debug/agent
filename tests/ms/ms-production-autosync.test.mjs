import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {taskPageUrl,stageUrl,parseProductionPage,normalizeTaskStages,
  makeLimitedReader,runMsProductionTick,REQUESTS_PER_TICK,
  REQUEST_GAP_MS,BATCH_SIZE}=await import('../../workers/ms-production-autosync.js');
const id=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const tasks=Array.from({length:5},(_,i)=>({
  id:id(i+1),name:String(740+i).padStart(5,'0'),
  moment:'2026-11-19 10:00:00.000',
  updated:'2026-11-20 12:00:00.000',
  deliveryPlannedMoment:'2026-11-21 12:00:00.000'
}));
const success=data=>new Response(JSON.stringify(data),{status:200});
const stage=i=>({
  meta:{size:1},rows:[{
    productionRow:{id:id(i+10)},stage:{name:'Раскрой материала'},
    totalQuantity:3,completedQuantity:i%2?1:3,orderingPosition:0
  }]
});
function fakeDb(){
  const runtime={generation:0,next_offset:0,total_first_seen:null,
    run_status:'new',lock_until_ms:0,last_request_ms:0};
  const rows=[];
  const db={
    runtime,rows,
    prepare(sql){
      return {bind(...args){
        return {
          async first(){
            assert.match(sql,/RETURNING generation,next_offset,total_first_seen,run_status/);
            const now=args[2],before=args[3];
            if(runtime.lock_until_ms>now||runtime.last_request_ms>before)return null;
            runtime.lock_until_ms=args[0];runtime.last_request_ms=args[1];
            return {...runtime};
          },
          async run(){
            if(sql.startsWith('INSERT INTO ms_production_auto_tasks')){
              rows.push(args);return {success:true};
            }
            if(sql.startsWith('UPDATE ms_production_auto_runtime SET generation=')){
              runtime.generation=args[0];runtime.next_offset=args[1];
              runtime.total_first_seen=args[2];runtime.run_status=args[3];
              runtime.lock_until_ms=0;return {success:true};
            }
            if(sql.startsWith('UPDATE ms_production_auto_runtime SET run_status=')){
              runtime.run_status=args[0];runtime.last_error_code=args[1];
              runtime.lock_until_ms=0;return {success:true};
            }
            throw Error('unexpected_query');
          }
        };
      }};
    },
    async batch(statements){for(const stmt of statements)await stmt.run();}
  };
  return db;
}
test('cursor page and per-task filtered stage URL are strictly scoped',()=>{
  assert.equal(BATCH_SIZE,5);
  assert.equal(REQUESTS_PER_TICK,6);
  assert.equal(REQUEST_GAP_MS,2000);
  const url=new URL(taskPageUrl(10));
  assert.equal(url.origin,'https://api.moysklad.ru');
  assert.equal(url.searchParams.get('limit'),'5');
  assert.equal(url.searchParams.get('order'),'moment,asc');
  assert.equal(url.searchParams.get('offset'),'10');
  const st=new URL(stageUrl(id(1)));
  assert.equal(st.searchParams.get('limit'),'50');
  assert.equal(st.searchParams.get('filter'),
    'productionTask=https://api.moysklad.ru/api/remap/1.2/entity/productiontask/'+id(1));
  for(const bad of [-1,1,100001,2.5,'0'])assert.throws(()=>taskPageUrl(bad));
  for(const bad of ['../../delete','',null,'bad'])assert.throws(()=>stageUrl(bad));
});
test('parse exact page and reject malformed documents or duplicate IDs',()=>{
  assert.deepEqual(parseProductionPage({meta:{size:5},rows:tasks},0).tasks.map(x=>x.number),
    ['00740','00741','00742','00743','00744']);
  assert.throws(()=>parseProductionPage({meta:{size:3},rows:tasks},0));
  assert.throws(()=>parseProductionPage({meta:{size:5},rows:[tasks[0],tasks[0]]},0));
  assert.throws(()=>parseProductionPage({meta:{size:5},rows:[{...tasks[0],id:'not-uuid'}]},0));
  assert.throws(()=>parseProductionPage({meta:{size:5},rows:[{...tasks[0],name:'DROP TABLE'}]},0));
  assert.throws(()=>parseProductionPage({meta:{size:5},rows:[]},0));
});
test('valid and malformed per-task stage aggregates never conflate missing with completed',()=>{
  const a=normalizeTaskStages({number:'00740'},stage(0));
  assert.equal(a.status,'complete');
  assert.equal(a.remaining,0);
  const b=normalizeTaskStages({number:'00741'},stage(1));
  assert.equal(b.status,'incomplete');
  assert.equal(b.remaining,2);
  assert.equal(b.firstStage,'Раскрой материала');
  const bad=normalizeTaskStages({number:'00740'},
    {meta:{size:2},rows:[stage(0).rows[0]]});
  assert.deepEqual(bad,{
    status:'unverified',plan:null,finished:null,remaining:null,firstStage:null
  });
});
test('one scheduled tick reads five tasks in SIX sequential GETs and commits only to dedicated D1',async()=>{
  const db=fakeDb(),calls=[],delays=[];
  const result=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_API_TOKEN:'synthetic-test-token',
    MS_PRODUCTION_DB:db
  },{
    nowMs:1_900_000_000_000,
    pause:async ms=>delays.push(ms),
    fetcher:async(url,opts)=>{
      calls.push(url);
      assert.equal(opts.method,'GET');
      assert.equal(opts.headers.Authorization,'Bearer synthetic-test-token');
      assert.equal(new URL(url).origin,'https://api.moysklad.ru');
      return new URL(url).pathname.endsWith('productiontask')?
        success({meta:{size:5},rows:tasks}):
        success(stage(calls.length-2));
    }
  });
  assert.equal(result.code,'ms_auto_batch_committed');
  assert.equal(result.requests,6);
  assert.equal(result.processed,5);
  assert.equal(result.generation,1);
  assert.equal(result.offset,5);
  assert.equal(result.status,'pass_complete');
  assert.equal(result.coverage,'BOUNDED_HISTORICAL_PASS_NOT_ALL_ACTIVE');
  assert.equal(db.rows.length,5);
  assert.equal(db.runtime.run_status,'pass_complete');
  assert.deepEqual(delays,Array(5).fill(2000));
  assert.ok(calls.every(x=>x.startsWith('https://api.moysklad.ru/')));
  assert.doesNotMatch(JSON.stringify(result),/synthetic-test-token|0074[0-9]/);
});
test('429 aborts after first stage, keeps cursor unchanged, no partial D1 task writes',async()=>{
  const db=fakeDb(),calls=[];
  const result=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_API_TOKEN:'synthetic-test-token',
    MS_PRODUCTION_DB:db
  },{
    nowMs:1_900_000_000_000,pause:async()=>{},
    fetcher:async(url)=>{
      calls.push(url);
      return calls.length===1?success({meta:{size:5},rows:tasks}):
        new Response('private sensitive upstream message',{status:429});
    }
  });
  assert.equal(result.code,'ms_rate_limited');
  assert.equal(result.requests,2);
  assert.equal(result.coverage,'UNVERIFIED_STOPPED');
  assert.equal(db.rows.length,0);
  assert.equal(db.runtime.next_offset,0);
  assert.equal(db.runtime.run_status,'paused');
  assert.doesNotMatch(JSON.stringify(result),/private sensitive upstream|synthetic-test-token/);
});
test('no token, no binding or disabled flag makes zero external calls',async()=>{
  let calls=0;
  const envs=[{},{
    MS_PRODUCTION_AUTO_SYNC:'disabled',MS_PRODUCTION_DB:fakeDb(),
    MS_API_TOKEN:'synthetic-test-token'
  },{
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_PRODUCTION_DB:fakeDb()
  }];
  for(const env of envs){
    const r=await runMsProductionTick(env,{
      fetcher:async()=>{calls++;throw Error('must not fetch');}
    });
    assert.ok(['ms_auto_disabled','ms_auto_missing_binding'].includes(r.code));
    assert.equal(r.requests,0);
  }
  assert.equal(calls,0);
});
test('source size decrease aborts without claiming a complete production snapshot',async()=>{
  const db=fakeDb();
  db.runtime.generation=1;db.runtime.next_offset=5;db.runtime.total_first_seen=744;
  db.runtime.run_status='scanning';
  const r=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_PRODUCTION_DB:db,
    MS_API_TOKEN:'synthetic-test-token'
  },{
    nowMs:1_900_000_000_000,fetcher:async()=>success({meta:{size:4},rows:[]})
  });
  assert.equal(r.code,'ms_auto_source_count_changed');
  assert.equal(db.runtime.run_status,'paused');
  assert.equal(db.rows.length,0);
});
