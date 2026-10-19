import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,createHmac} from 'node:crypto';
import {parseList,intakeCommand,bridgeRequest,reviewText} from './intake.mjs';
function fixture(){
  const sheets=new Map();let flushFail=false;
  class Sheet{
    rows=[];max=1000;
    getLastRow(){return this.rows.length;}getMaxRows(){return this.max;}insertRowsAfter(_n,count){this.max+=count;}
    setFrozenRows(){return this;}setColumnWidths(){return this;}
    getRange(row,col,height=1,width=1){const self=this;return {
      getValues(){return Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>self.rows[row+r-1]?.[col+c-1]??''));},
      setValues(values){assert.ok(row+values.length-1<=self.max);values.forEach((values,r)=>{self.rows[row+r-1]||=[];values.forEach((v,c)=>{self.rows[row+r-1][col+c-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;});});return this;},
      setValue(value){return this.setValues([[value]]);},setFontWeight(){return this;},setBackground(){return this;},setWrap(){return this;}
    };}
  }
  const book={getId:()=> '11Qb-AR6nlR-Yt89Pu8nviqAud7h6Hrmba4gNEXU47Q4',getSheetByName:name=>sheets.get(name),insertSheet(name){const sheet=new Sheet();sheets.set(name,sheet);return sheet;}};
  const values={MAX_BRIDGE_KEY:'k'.repeat(64),MAX_OWNER_ID:'123',MAX_WORK_CHAT_ID:'-456'};const props={getProperty:name=>values[name]};
  const context=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_a,text)=>[...createHash('sha256').update(text).digest()],computeHmacSha256Signature:(text,key)=>[...createHmac('sha256',key).update(text).digest()]},SpreadsheetApp:{openById:id=>{assert.equal(id,book.getId());return book;},flush(){if(flushFail){flushFail=false;throw Error('simulated failure');}}},PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}});
  vm.runInContext(readFileSync(new URL('./google/MaxBridge.gs',import.meta.url),'utf8'),context);
  return {sheets,props,context,process:d=>context.maxBridgeProcess_(d,props),failFlush:()=>{flushFail=true;}};
}
const draft=()=>({action:'draft',id:'a'.repeat(24),chatId:'-456',userId:'123',messageId:'sample-mid',raw:'1) Тестовый товар A — 2 шт. (запас отдельно)',items:[{number:1,title:'Тестовый товар A',quantity:2,notes:'(запас отдельно)'}],issues:[]});
test('draft repeat and copied message reuse record; confirmation writes once',()=>{
  const f=fixture(),d=draft(),first=f.process(d);assert.equal(first.status,'draft');
  assert.equal(f.process({...d,id:'b'.repeat(24),messageId:'another-mid'}).id,d.id);
  assert.equal(f.sheets.get('MAX — очередь').rows.length,2);
  const confirm={action:'confirm',id:d.id,chatId:d.chatId,userId:d.userId,expected:first.revision};
  assert.equal(f.process(confirm).status,'confirmed');assert.equal(f.process(confirm).status,'confirmed');assert.equal(f.sheets.get('Заявки MAX').rows.length,2);
  assert.equal(f.sheets.size,2);
});
test('stale revision, unresolved lines and foreign source cannot write',()=>{
  const f=fixture(),d=draft(),first=f.process({...d,issues:['Нужны уточнения']});
  assert.throws(()=>f.process({action:'confirm',id:d.id,chatId:d.chatId,userId:d.userId,expected:'0'.repeat(12)}),/stale-revision/);
  assert.throws(()=>f.process({action:'confirm',id:d.id,chatId:d.chatId,userId:d.userId,expected:first.revision}),/clarification-required/);
  assert.throws(()=>f.process({...d,chatId:'-999'}),/forbidden-source/);assert.equal(f.sheets.has('Заявки MAX'),false);
});
test('ambiguous output write recovers without duplicate and formula-like text stays literal',()=>{
  const f=fixture(),d=draft();d.items[0].title='=TEST()';d.items[0].notes='-пример';const first=f.process(d);
  const confirm={action:'confirm',id:d.id,chatId:d.chatId,userId:d.userId,expected:first.revision};
  f.failFlush();assert.throws(()=>f.process(confirm),/simulated failure/);
  assert.equal(f.process(confirm).status,'confirmed');assert.equal(f.sheets.get('Заявки MAX').rows.length,2);assert.equal(f.sheets.get('Заявки MAX').rows[1][3],'=TEST()');
});
test('unsigned and stale bridge requests cannot access data',()=>{
  const f=fixture();assert.equal(JSON.parse(f.context.doPost({postData:{contents:JSON.stringify({timestamp:Date.now(),body:'{}',signature:'bad'})}}).text).error,'unauthorized');assert.equal(f.sheets.size,0);
});
test('parser keeps notes, flags extra goods and requires quantities',()=>{
  const good=parseList('Отгрузки по чехлам:\n1) Тестовый товар — 2 шт. (на завтра)');assert.equal(good.items[0].quantity,2);assert.equal(good.issues.length,0);assert.equal(good.items[0].notes,'(на завтра)');
  assert.ok(parseList('1) Тестовый товар — 2 шт. + 1 деталь').issues.length);
  assert.ok(parseList('1) Товар без количества').issues.length);
});
test('intake is owner-only, private-dialog-only and exact confirmation revision',()=>{
  const env={MAX_OWNER_ID:'123',MAX_WORK_CHAT_ID:'-456'};
  const e={update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog',chat_id:456},body:{mid:'test',text:'Принять заявку\n1) Тестовый товар — 2 шт.'}}};
  assert.equal(intakeCommand(e,env).action,'draft');assert.equal(intakeCommand(e,{...env,MAX_WORK_CHAT_ID:''}),null);assert.equal(intakeCommand(e,{...env,MAX_OWNER_ID:'999'}),null);
  for(const chat_id of [-456,-789])assert.equal(intakeCommand({...e,message:{...e.message,recipient:{chat_type:'chat',chat_id}}},env),null);
  assert.equal(intakeCommand({...e,message:{...e.message,body:{mid:'confirm',text:'/confirm '+ 'a'.repeat(24)+' '+ 'b'.repeat(12)}}},env).action,'confirm');
  assert.equal(intakeCommand({...e,message:{...e.message,recipient:{chat_type:'chat',chat_id:-456},body:{mid:'confirm',text:'/confirm '+ 'a'.repeat(24)+' '+ 'b'.repeat(12)}}},env),null);
});
test('bridge signature binds complete body and no secret is sent in URL',async()=>{
  const env={SHEETS_BRIDGE_URL:'https://script.google.com/macros/s/test/exec',SHEETS_BRIDGE_KEY:'k'.repeat(64)};
  const result=await bridgeRequest(env,{action:'ping'},async(url,options)=>{
    assert.equal(url,env.SHEETS_BRIDGE_URL);const signed=JSON.parse(options.body);assert.equal(signed.signature,createHmac('sha256',env.SHEETS_BRIDGE_KEY).update(signed.timestamp+'\n'+signed.body).digest('hex'));return Response.json({ok:true});
  });assert.equal(result.ok,true);
  assert.doesNotMatch(reviewText({ok:true,status:'draft',id:'a'.repeat(24),revision:'b'.repeat(12),items:[{number:1,title:'x'.repeat(4000),quantity:1,notes:''}],issues:[]}),/\/confirm/);
});
