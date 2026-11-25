import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {verifyStageTaskLinks,taskPageUrl,stageUrl,parseProductionPage,normalizeTaskStages,
  makeLimitedReader,bridgeUrlFor,runMsProductionTick,REQUESTS_PER_TICK,
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
              // Mirror D1's primary-key uniqueness: a moving page may not
              // silently re-insert a task already seen in this generation.
              if(rows.some(row=>row[0]===args[0]&&row[1]===args[1]))
                throw Error('UNIQUE constraint failed');
              rows.push(args);return {success:true};
            }
            if(sql.startsWith('UPDATE ms_production_auto_runtime SET generation=')){
              runtime.generation=args[0];runtime.next_offset=args[1];
              runtime.total_first_seen=args[2];runtime.run_status=args[3];
              runtime.lock_until_ms=0;return {success:true};
            }
            if(sql.startsWith('UPDATE ms_production_auto_runtime SET run_status=')){
              runtime.run_status=args[0];runtime.last_error_code=args[1];
              runtime.lock_until_ms=args[2]||0;return {success:true};
            }
            throw Error('unexpected_query');
          }
        };
      }};
    },
    async batch(statements){
      const priorRows=rows.length,priorRuntime={...runtime};
      try{for(const stmt of statements)await stmt.run();}
      catch(error){
        // D1 batch is transactional; emulate rollback of staged rows + cursor.
        rows.splice(priorRows);Object.assign(runtime,priorRuntime);
        throw error;
      }
    }
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
test('explicit cross-task production references are never treated as own completed work',()=>{
  const own={...tasks[0]};
  const other=tasks[1].id;
  const ownHref='https://api.moysklad.ru/api/remap/1.2/entity/productiontask/'+own.id;
  const rowId=id(31);
  const nested=taskId=>ownHref.replace(own.id,taskId)+'/productionRows/'+rowId;
  assert.equal(verifyStageTaskLinks(own.id,{
    meta:{size:1},rows:[{...stage(0).rows[0],
      productionTask:{meta:{href:ownHref}},
      productionRow:{meta:{href:nested(own.id)}}}]
  }),true);
  for(const row of [
    {...stage(0).rows[0],productionTask:{id:other}},
    {...stage(0).rows[0],productionTask:{meta:{href:ownHref.replace(own.id,other)}}},
    {...stage(0).rows[0],productionRow:{meta:{href:nested(other)}}},
    {...stage(0).rows[0],productionRow:{meta:{href:'https://evil.invalid/entity/productiontask/'+own.id+'/productionRows/'+rowId}}}
  ]){
    const payload={meta:{size:1},rows:[row]};
    assert.equal(verifyStageTaskLinks(own.id,payload),false);
    const evaluated=normalizeTaskStages({id:own.id,number:own.name},payload);
    assert.equal(evaluated.status,'unverified');
    assert.equal(evaluated.remaining,null);
  }
  assert.equal(verifyStageTaskLinks(own.id,stage(0)),true);
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
test('transient upstream failure preserves the saved cursor and defers without burst retry',async()=>{
  const db=fakeDb(),calls=[];
  db.runtime.generation=12;db.runtime.next_offset=115;
  db.runtime.total_first_seen=755;db.runtime.run_status='scanning';
  const now=1_900_000_000_000;
  const first=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_API_TOKEN:'synthetic-test-token',
    MS_PRODUCTION_DB:db
  },{
    nowMs:now,pause:async()=>{},
    fetcher:async(url)=>{
      calls.push(url);
      return calls.length===1?success({meta:{size:755},rows:tasks}):
        new Response('temporary upstream response',{status:503,headers:{'Retry-After':'360'}});
    }
  });
  assert.equal(first.code,'ms_api_upstream_error');
  assert.equal(first.retryAfterMs,360000);
  assert.equal(first.requests,2);
  assert.equal(calls.length,2);
  assert.equal(db.runtime.next_offset,115);
  assert.equal(db.runtime.lock_until_ms,now+360000);
  assert.equal(db.rows.length,0);
  const tooSoon=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_API_TOKEN:'synthetic-test-token',
    MS_PRODUCTION_DB:db
  },{nowMs:now+300000,fetcher:async()=>{throw Error('must remain deferred');}});
  assert.equal(tooSoon.code,'ms_auto_locked_or_recent');
  assert.equal(tooSoon.requests,0);
  assert.equal(db.runtime.next_offset,115);
  const resumed=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_API_TOKEN:'synthetic-test-token',
    MS_PRODUCTION_DB:db
  },{
    nowMs:now+360000,pause:async()=>{},
    fetcher:async url=>new URL(url).pathname.endsWith('/productiontask')?
      success({meta:{size:755},rows:tasks}):
      success(stage(0))
  });
  assert.equal(resumed.code,'ms_auto_batch_committed');
  assert.equal(resumed.offset,120);
  assert.equal(resumed.generation,12);
  assert.equal(db.runtime.next_offset,120);
  assert.equal(db.rows.length,5);
  assert.doesNotMatch(JSON.stringify(first),/synthetic-test-token|temporary upstream response/);
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
test('duplicate across historical pages aborts transaction instead of silently advancing cursor',async()=>{
  const db=fakeDb();
  db.runtime.generation=1;
  db.runtime.next_offset=5;
  db.runtime.total_first_seen=10;
  db.runtime.run_status='scanning';
  db.rows.push([1,tasks[0].id,'00740']);
  const r=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',MS_API_TOKEN:'synthetic-test-token',
    MS_PRODUCTION_DB:db
  },{
    nowMs:1_900_000_000_000,pause:async()=>{},
    fetcher:async url=>new URL(url).pathname.endsWith('/productiontask')?
      success({meta:{size:10},rows:tasks}):
      success(stage(0))
  });
  assert.equal(r.code,'ms_auto_sync_error');
  assert.equal(r.coverage,'UNVERIFIED_STOPPED');
  assert.equal(db.runtime.next_offset,5);
  assert.equal(db.runtime.run_status,'paused');
  assert.equal(db.rows.length,1);
  assert.doesNotMatch(JSON.stringify(r),/00740|synthetic-test-token/);
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

test('a short middle page is rejected before querying its stages or advancing the cursor',async()=>{
  assert.throws(()=>parseProductionPage({meta:{size:744},rows:tasks.slice(0,2)},5));
  assert.deepEqual(parseProductionPage({meta:{size:7},rows:tasks.slice(0,2)},5).tasks.map(x=>x.number),
    ['00740','00741']);
  const db=fakeDb();
  const calls=[];
  const result=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',
    MS_PRODUCTION_DB:db,
    MS_API_TOKEN:'synthetic-test-token'
  },{
    nowMs:1_900_000_000_000,
    fetcher:async url=>{
      calls.push(url);
      return success({meta:{size:744},rows:tasks.slice(0,2)});
    },
    pause:async()=>{}
  });
  assert.equal(result.code,'invalid_production_page');
  assert.equal(result.coverage,'UNVERIFIED_STOPPED');
  assert.equal(result.requests,1);
  assert.equal(calls.length,1);
  assert.equal(db.rows.length,0);
  assert.equal(db.runtime.next_offset,0);
  assert.equal(db.runtime.run_status,'paused');
});

test('source size increase mid-generation stops instead of mixing two moving inventories',async()=>{
  const db=fakeDb();
  db.runtime.generation=1;
  db.runtime.next_offset=5;
  db.runtime.total_first_seen=744;
  db.runtime.run_status='scanning';
  const calls=[];
  const result=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',
    MS_PRODUCTION_DB:db,
    MS_API_TOKEN:'synthetic-test-token'
  },{
    nowMs:1_900_000_000_000,
    fetcher:async url=>{
      calls.push(url);
      return success({meta:{size:745},rows:tasks});
    },
    pause:async()=>{}
  });
  assert.equal(result.code,'ms_auto_source_count_changed');
  assert.equal(result.coverage,'UNVERIFIED_STOPPED');
  assert.equal(result.requests,1);
  assert.equal(calls.length,1);
  assert.equal(db.rows.length,0);
  assert.equal(db.runtime.next_offset,5);
  assert.equal(db.runtime.run_status,'paused');
});

test('after source-count drift, next tick autonomously restarts an isolated generation at offset zero',async()=>{
  const db=fakeDb();
  db.runtime.generation=4;
  db.runtime.next_offset=35;
  db.runtime.total_first_seen=744;
  db.runtime.run_status='paused';
  db.runtime.last_error_code='ms_auto_source_count_changed';
  const urls=[];
  const result=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',
    MS_API_TOKEN:'synthetic-test-token',
    MS_PRODUCTION_DB:db
  },{
    nowMs:1_900_000_000_000,
    pause:async()=>{},
    fetcher:async url=>{
      urls.push(url);
      return new URL(url).pathname.endsWith('/productiontask')?
        success({meta:{size:5},rows:tasks}):
        success(stage(urls.length-2));
    }
  });
  assert.equal(result.code,'ms_auto_batch_committed');
  assert.equal(result.generation,5);
  assert.equal(result.offset,5);
  assert.equal(result.status,'pass_complete');
  assert.equal(result.requests,6);
  assert.equal(db.rows.length,5);
  assert.equal(db.runtime.generation,5);
  assert.equal(db.runtime.total_first_seen,5);
  assert.equal(new URL(urls[0]).searchParams.get('offset'),'0');
});

test('Worker uses authenticated Pages read-only bridge without a second MoySklad token',async()=>{
  const secret='A'.repeat(43);
  const {createProductionBridgeHandler}=await import('../../functions/api/ms/production-bridge.js');
  const db=fakeDb();
  let external=0,relay=0;
  const pages=createProductionBridgeHandler({fetcher:async(upstream,options)=>{
    external++;
    assert.equal(options.headers.Authorization,'Bearer existing-Pages-secret-token');
    return new URL(upstream).pathname.endsWith('/productiontask')?
      success({meta:{size:5},rows:tasks}):success(stage((external-2)%5));
  }});
  const out=await runMsProductionTick({
    MS_PRODUCTION_AUTO_SYNC:'enabled',
    MS_PRODUCTION_DB:db,
    MS_PRODUCTION_BRIDGE_SECRET:secret
  },{
    nowMs:1_900_000_000_000,pause:async()=>{},
    fetcher:async(url,options)=>{
      relay++;
      assert.equal(new URL(url).origin,'https://autosklad63-office-staging.pages.dev');
      assert.equal(new URL(url).pathname,'/api/ms/production-bridge');
      assert.equal(options.method,'GET');
      assert.equal(options.headers.Authorization,undefined);
      assert.equal(typeof options.headers['X-MS-Bridge-Signature'],'string');
      return pages({
        request:new Request(url,{method:'GET',headers:options.headers}),
        env:{MS_API_TOKEN:'existing-Pages-secret-token',MS_PRODUCTION_BRIDGE_SECRET:secret}
      });
    }
  });
  assert.equal(out.code,'ms_auto_batch_committed');
  assert.equal(out.requests,6);
  assert.equal(out.processed,5);
  assert.equal(db.runtime.next_offset,5);
  assert.equal(relay,6);
  assert.equal(external,6);
  assert.doesNotMatch(JSON.stringify(out),/existing-Pages-secret-token|00000000-0000-4000/);
});
test('Worker bridge rejects URL rewriting or non-production resource access',()=>{
  assert.ok(bridgeUrlFor(taskPageUrl(0)).toString().includes('kind=tasks'));
  assert.ok(bridgeUrlFor(stageUrl(tasks[0].id)).toString().includes('kind=stages'));
  for(const bad of [
    'http://api.moysklad.ru/api/remap/1.2/entity/productiontask?limit=5&offset=0&order=moment%2Casc',
    'https://evil.example/productiontask?limit=5&offset=0&order=moment%2Casc',
    'https://api.moysklad.ru/api/remap/1.2/entity/productiontask?limit=5&offset=0&order=moment%2Casc&delete=true',
    'https://api.moysklad.ru/api/remap/1.2/entity/customerorder?limit=5&offset=0&order=moment%2Casc'
  ])assert.throws(()=>bridgeUrlFor(bad));
});
