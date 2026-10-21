// Sandbox only: no Bridge, MoySklad or employee messaging dependencies.
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync,fsyncSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const roles=['olga','alexandra','irina','dmitry'];
const help='ТЕСТ. /test role olga|alexandra|irina|dmitry; /test plan; /test produce 1|2|3|4; /test pack; /test handover; /test accept; /test status. Только вымышленные данные.';
export async function packingTest(event,env){
 const m=event?.message,text=m?.body?.text||'';
 if(!/^\/test(?:\s|$)/u.test(text))return null;
 if(event.update_type!=='message_created'||!Number.isFinite(event.timestamp)||Math.abs(Date.now()-event.timestamp)>300000||!/^\d+$/.test(env.MAX_OWNER_ID||'')||m.sender?.user_id!==Number(env.MAX_OWNER_ID)||m.sender?.is_bot||m.recipient?.chat_type!=='dialog'||typeof m.body?.mid!=='string'||!m.body.mid||m.body.mid.length>200)return {ignored:true};
 if(env.MAX_PACKING_TEST_ENABLED!=='true')return {text:'Тестовый режим выключен.'};
 const dir=env.MAX_PACKING_TEST_DIR;
 if(!dir||!isAbsolute(dir))return {text:'Тестовое хранилище не настроено. Данные не изменены.'};
 mkdirSync(dir,{recursive:true,mode:0o700});
 if(lstatSync(dir).isSymbolicLink())throw Error('unsafe sandbox');
 const file=join(dir,'packing-test-v1.json'),lock=join(dir,'packing-test-v1.lock'),temp=join(dir,'packing-test-v1.tmp');
 const fd=openSync(lock,'wx',0o600);
 try{
  let s;
  try{if(lstatSync(file).isSymbolicLink())throw Error('unsafe state');s=JSON.parse(readFileSync(file,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;s={namespace:'autosklad63-packing-test-v1',session:randomUUID(),role:'olga',plan:0,produced:0,packed:0,handed:0,accepted:0,sewers:[],journal:[],receipts:{}};}
  if(s.namespace!=='autosklad63-packing-test-v1'||!roles.includes(s.role)||!Array.isArray(s.journal)||!Array.isArray(s.sewers)||!s.receipts||![s.plan,s.produced,s.packed,s.handed,s.accepted].every(Number.isSafeInteger)||s.accepted<0||s.accepted>s.handed||s.handed>s.packed||s.packed>s.produced||s.produced>16||s.plan<0||s.plan>15)throw Error('invalid sandbox state');
  const key=createHash('sha256').update(m.body.mid).digest('hex');
  if(Object.hasOwn(s.receipts,key))return s.receipts[key];
  if(s.journal.length>=2000)throw Error('sandbox capacity reached');
  if(![0,15].includes(s.plan)||![0,15].includes(s.packed)||![0,15].includes(s.handed)||![0,15].includes(s.accepted)||new Set(s.sewers).size!==s.sewers.length||s.sewers.some(x=>!['1','2','3','4'].includes(x))||s.produced!==s.sewers.length*4||s.produced>0&&s.plan!==15)throw Error('invalid sandbox counters');
  const action=text.trim().split(/\s+/).slice(1).join(' ');
  let status='ok',reply=help;
  const reject=()=>{status='rejected';reply='ТЕСТ: неверная роль, повторная операция или недопустимый переход. '+help;};
  if(action.startsWith('role ')&&roles.includes(action.slice(5))){s.role=action.slice(5);reply='ТЕСТ: роль '+s.role;}
  else if(action==='plan'&&s.role==='olga'&&s.plan===0){s.plan=15;reply='ТЕСТ: план 15, маркировки готовы: Ozon 8, ВБ 3, Авито 2, Пламя 2.';}
  else if(/^produce [1-4]$/.test(action)&&s.role==='alexandra'&&s.plan===15&&!s.packed&&!s.sewers.includes(action.at(-1))){s.sewers.push(action.at(-1));s.produced+=4;reply='ТЕСТ: принято 4 готовых изделия от вымышленной швеи '+action.at(-1);}
  else if(action==='pack'&&s.role==='irina'&&s.produced===16&&s.packed===0){s.packed=15;reply='ТЕСТ: упаковано 15.';}
  else if(action==='handover'&&s.role==='irina'&&s.packed===15&&s.handed===0){s.handed=15;reply='ТЕСТ: подготовлена передача 15. Требуется подтверждение водителя.';}
  else if(action==='accept'&&s.role==='dmitry'&&s.handed===15&&s.accepted===0){s.accepted=15;reply='ТЕСТ: водитель подтвердил получение 15. Приёмка маркетплейсом не подтверждена.';}
  else if(action!==''&&action!=='status')reject();
  reply+='\nПлан: '+s.plan+'; изготовлено: '+s.produced+'; упаковано: '+s.packed+'; передача: '+s.handed+'; принято водителем: '+s.accepted+'; осталось: '+(s.produced-s.accepted)+'. Списание: 0. Приёмка маркетплейсом: неизвестно.';
  const result={text:reply};
  const safeAction=/^(?:|status|plan|pack|handover|accept|produce [1-4]|role (?:olga|alexandra|irina|dmitry))$/.test(action)?action:'invalid';
  s.journal.push({id:randomUUID(),date:new Date().toISOString(),role:s.role,action:safeAction,status,session:s.session});
  s.receipts[key]=result;
  const out=openSync(temp,'wx',0o600);
  try{writeFileSync(out,JSON.stringify(s));fsyncSync(out);}finally{closeSync(out);}
  renameSync(temp,file);
  return result;
 }finally{closeSync(fd);unlinkSync(lock);}
}
