// Isolated, opt-in synthetic journal replication. No production imports.
import {readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync,fsyncSync} from 'node:fs';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
const fixtureIds=new Set(['TEST-OZ-1','TEST-OZ-2','TEST-WB-1','TEST-AV-1','TEST-PL-1']);
const actions=new Set(['produce','pack','handover','accept']);
export function sheetsTestConfig(env){
 const url=env.MAX_TEST_SHEETS_URL,key=env.MAX_TEST_SHEETS_KEY;
 if(!url&&!key)return null;
 if(!url||!key||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)||key.length<32)throw Error('invalid test sheets configuration');
 return {url,key};
}
export function syntheticEvents(state){
 if(state?.namespace!=='autosklad63-packing-orders-v1'||!Array.isArray(state.journal)||!Array.isArray(state.positions))throw Error('invalid synthetic state');
 const positions=new Map(state.positions.map(p=>[p.id,p]));
 if(positions.size!==5||[...positions.keys()].some(id=>!fixtureIds.has(id)))throw Error('invalid synthetic fixtures');
 return state.journal.filter(j=>j.status==='ok'&&actions.has(j.action?.split(' ')[0])).map(j=>{
  const words=j.action.split(' '),action=words[0],positionId=action==='accept'?'':words[action==='handover'?2:1],quantity=action==='accept'?0:Number(words[action==='handover'?3:2]);
  const operationId=words.at(-1),shipmentId=['handover','accept'].includes(action)?words[1]:'';
  if(!/^[a-f0-9-]{36}$/.test(j.id)||!/^TEST-[A-Z0-9-]+$/.test(positionId||'TEST-X')||positionId&&!positions.has(positionId)||!/^([A-Za-z][A-Za-z0-9-]{0,47})$/.test(operationId)||!['handover','accept'].includes(action)&&(!Number.isSafeInteger(quantity)||quantity<1)||!['handover','accept'].includes(action)&&shipmentId||!['produce','pack'].includes(action)&&!/^SHIP-[A-Za-z0-9-]{1,24}$/.test(shipmentId)||!['olga','alexandra','irina','dmitry'].includes(j.role))throw Error('invalid synthetic event');
  const p=positions.get(positionId);
  return {id:state.session+':'+j.id,session:state.session,date:j.date,role:j.role,action,positionId,orderId:p?.orderId||'',quantity,shipmentId,operationId};
 });
}
export async function sendSyntheticEvent(config,event,fetcher=fetch){
 const timestamp=Date.now(),body=JSON.stringify({action:'test-event',event}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 const signature=createHmac('sha256',config.key).update(timestamp+'\n'+body).digest('hex');
 const response=await fetcher(config.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,body,signature}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('test bridge HTTP error');
 const result=await response.json();if(result?.ok!==true)throw Error('test bridge rejected event');
 return result;
}
// Cursor advances only after an acknowledged write; replay is safe via GAS event-ID dedup.
export async function flushSyntheticJournal(dir,config,fetcher=fetch){
 if(!config)return 0;
 const lock=join(dir,'packing-sheets-sync.lock'),fd=openSync(lock,'wx',0o600);
 try{
  let state;try{state=JSON.parse(readFileSync(join(dir,'packing-orders-v1.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return 0;throw e;}
  const events=syntheticEvents(state),cursorFile=join(dir,'packing-sheets-sync-v1.json');
  let cursor;try{cursor=JSON.parse(readFileSync(cursorFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;cursor={session:state.session,index:0};}
  if(cursor.session!==state.session)cursor={session:state.session,index:0};
  if(!Number.isSafeInteger(cursor.index)||cursor.index<0||cursor.index>events.length)throw Error('invalid sync cursor');
  let count=0;
  for(let i=cursor.index;i<events.length;i++){
   await sendSyntheticEvent(config,events[i],fetcher);
   const temp=cursorFile+'.tmp',out=openSync(temp,'w',0o600);
   try{writeFileSync(out,JSON.stringify({session:state.session,index:i+1}));fsyncSync(out);}finally{closeSync(out);}
   renameSync(temp,cursorFile);count++;
  }
  return count;
 }finally{closeSync(fd);unlinkSync(lock);}
}
