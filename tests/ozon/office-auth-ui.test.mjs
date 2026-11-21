import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/office-auth.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../../web/office/style.css',import.meta.url),'utf8');

test('single owner login is in shared header and is independent from Ozon',()=>{
  const top=html.indexOf('<header class="topbar">');
  const firstSection=html.indexOf('data-section="ozonProfit"');
  assert.ok(top>0&&top<firstSection);
  for(const id of ['officeAuth','officeAuthState','officeAuthLogin','officeAuthLogout','officeAuthRetry']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
    assert.ok(html.indexOf('id="'+id+'"')<firstSection);
  }
  assert.match(html,/src="office-auth\.js\?v=20261121" defer/);
  assert.match(styles,/\.office-auth \[hidden\]\{display:none!important\}/);
  assert.match(html,/href="\/api\/auth\/google\/start\?next=ozonFinance"/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|document\.cookie/);
});
function makeHarness(status,body){
  const ids=['officeAuth','officeAuthState','officeAuthLogin','officeAuthLogout','officeAuthRetry'];
  const elements=new Map(ids.map(id=>[id,{
    id,hidden:false,textContent:'',href:'',disabled:false,
    listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}
  }]));
  const windowEvents={};
  const documentEvents={};
  const requests=[];
  const location={hash:'#production',reloaded:false,reload(){this.reloaded=true;}};
  let responseStatus=status;
  let responseBody=body;
  const fetch=async(path,opts)=>{
    requests.push({path,opts});
    if(path==='/api/auth/logout')return {status:200,ok:true};
    assert.equal(path,'/api/auth/me');
    return {
      status:responseStatus,
      ok:responseStatus===200,
      async json(){return responseBody;}
    };
  };
  const document={
    visibilityState:'visible',
    getElementById(id){return elements.get(id)||null;},
    addEventListener(name,fn){documentEvents[name]=fn;}
  };
  const window={addEventListener(name,fn){windowEvents[name]=fn;}};
  runInNewContext(js,{
    document,window,location,fetch,
    AbortSignal:{timeout:()=>undefined},
    Set,Date,encodeURIComponent
  });
  return {elements,location,requests,windowEvents,documentEvents,
    setResponse(nextStatus,nextBody){responseStatus=nextStatus;responseBody=nextBody;}
  };
}
const settle=async()=>{
  for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));
};

test('anonymous visitor sees login on production without any finance navigation',async()=>{
  const app=makeHarness(401,{authenticated:false});
  await settle();
  assert.equal(app.elements.get('officeAuthLogin').hidden,false);
  assert.equal(app.elements.get('officeAuthLogout').hidden,true);
  assert.equal(app.elements.get('officeAuthLogin').href,
    '/api/auth/google/start?next=production');
  assert.equal(app.elements.get('officeAuthState').textContent,'Вход не выполнен');
  assert.equal(app.requests.filter(x=>x.path==='/api/auth/me').length,1);
  app.location.hash='#ozonFinance';
  app.windowEvents.hashchange();
  assert.equal(app.elements.get('officeAuthLogin').href,
    '/api/auth/google/start?next=ozonFinance');
  app.location.hash='#//evil.invalid';
  app.windowEvents.hashchange();
  assert.equal(app.elements.get('officeAuthLogin').href,
    '/api/auth/google/start?next=overview');
});

test('owner sees verified session and a single logout clears loaded office data',async()=>{
  const app=makeHarness(200,{authenticated:true,role:'owner'});
  await settle();
  assert.equal(app.elements.get('officeAuthLogout').hidden,false);
  assert.equal(app.elements.get('officeAuthLogin').hidden,true);
  assert.equal(app.elements.get('officeAuthState').textContent,'Вход владельца выполнен');
  const logout=app.elements.get('officeAuthLogout');
  await logout.listeners.click();
  assert.equal(app.requests.at(-1).path,'/api/auth/logout');
  assert.equal(app.requests.at(-1).opts.method,'POST');
  assert.equal(app.location.reloaded,true);
});

test('server outage does not incorrectly claim Google account is signed out',async()=>{
  const app=makeHarness(503,{authenticated:false});
  await settle();
  assert.equal(app.elements.get('officeAuthLogin').hidden,true);
  assert.equal(app.elements.get('officeAuthRetry').hidden,false);
  assert.match(app.elements.get('officeAuthState').textContent,/Сервис проверки входа недоступен/);
  app.setResponse(200,{authenticated:true,role:'owner'});
  await app.elements.get('officeAuthRetry').listeners.click();
  await settle();
  assert.equal(app.elements.get('officeAuthLogout').hidden,false);
});
