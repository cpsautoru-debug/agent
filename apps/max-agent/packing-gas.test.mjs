import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
function fixture(){
 const tables=new Map(),writes=[];let failBalance=false;
 function sheet(name,headers){const rows=[headers];tables.set(name,rows);return {getLastRow:()=>rows.length,getRange(r,c,n,m){return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r+i-1]?.[c+j-1]??'')),setValues(values){if(name==='MAX тест — сверка'&&failBalance){failBalance=false;throw Error('temporary balance failure');}writes.push(name);values.forEach((row,i)=>{rows[r+i-1]??=[];row.forEach((v,j)=>rows[r+i-1][c+j-1]=v);});}};}};}
 const context={console,Date,JSON,Number,Error,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'k'.repeat(64)})},Utilities:{computeHmacSha256Signature:(body,key)=>[...createHmac('sha256',key).update(body).digest()]},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},SpreadsheetApp:{openById(id){assert.equal(id,'1x3B-6sdabZNNHCpy8la7Oqwgja7yBjU1G0n1ku0kMoI');return {getSheetByName:name=>sheets.get(name)||null};},flush(){}}};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('./google/PackingTestBridge.gs',import.meta.url),'utf8'),context);
 const sheets=new Map([['MAX тест — события',sheet('MAX тест — события',context.PACKING_EVENT_HEADERS)],['MAX тест — сверка',sheet('MAX тест — сверка',context.PACKING_BALANCE_HEADERS)]]);
 const session=randomUUID();
 const event=(action,positionId,quantity,operationId,shipmentId='')=>({id:session+':'+randomUUID(),session,date:new Date().toISOString(),role:action==='produce'?'alexandra':action==='accept'?'dmitry':'irina',action,positionId,orderId:positionId==='TEST-OZ-1'||positionId==='TEST-OZ-2'?'TEST-OZ':'',quantity,shipmentId,operationId});
 function send(e,sign=true){const timestamp=Date.now(),body=JSON.stringify({action:'test-event',event:e}),signature=sign?createHmac('sha256','k'.repeat(64)).update(timestamp+'\n'+body).digest('hex'):'forged';return JSON.parse(context.doPost({postData:{contents:JSON.stringify({timestamp,body,signature})}}).text);}
 return {tables,writes,event,send,failNextBalance:()=>{failBalance=true;}};
}
test('GAS signed full chain preserves per-position balance and repeats once',()=>{
 const f=fixture(),events=[f.event('produce','TEST-OZ-1',3,'sew-a'),f.event('pack','TEST-OZ-1',2,'pack-a'),f.event('handover','TEST-OZ-1',2,'hand-a','SHIP-A'),f.event('accept','',0,'accept-a','SHIP-A')];
 for(const e of events)assert.equal(f.send(e).ok,true);
 assert.equal(f.send(events[3]).duplicate,true);assert.equal(f.tables.get('MAX тест — события').length,5);
 assert.deepEqual(f.tables.get('MAX тест — сверка')[1].slice(2,8),[5,3,2,2,2,1]);
 assert.ok(f.writes.every(name=>name.startsWith('MAX тест —')));
});
test('GAS lost acknowledgement or partial balance write repairs without duplicate event',()=>{
 const f=fixture(),e=f.event('produce','TEST-OZ-1',2,'sew-b');f.failNextBalance();
 assert.equal(f.send(e).ok,false);assert.equal(f.tables.get('MAX тест — события').length,2);
 const retry=f.send(e);assert.equal(retry.ok,true);assert.equal(retry.duplicate,true);assert.equal(f.tables.get('MAX тест — события').length,2);assert.equal(f.tables.get('MAX тест — сверка')[1][3],2);
});
test('GAS forged, wrong-role and unprepared shipment events cannot write',()=>{
 const f=fixture(),e=f.event('produce','TEST-OZ-1',2,'sew-c');
 assert.equal(f.send(e,false).error,'unauthorized');assert.equal(f.send({...e,role:'dmitry'}).error,'bad-test-role');assert.equal(f.send(f.event('accept','',0,'accept-c','SHIP-MISSING')).error,'shipment-not-prepared');assert.equal(f.writes.length,0);
});
test('same event ID with changed content is a conflict rather than an acknowledged duplicate',()=>{
 const f=fixture(),e=f.event('produce','TEST-OZ-1',2,'sew-d');assert.equal(f.send(e).ok,true);
 assert.equal(f.send({...e,quantity:3}).error,'event-conflict');assert.equal(f.tables.get('MAX тест — события').length,2);
});
