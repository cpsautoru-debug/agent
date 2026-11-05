// Synthetic order positions only. No production adapters or external I/O.
import {mkdirSync,lstatSync,openSync,readFileSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const namespace='autosklad63-packing-orders-v1';
const roles=['olga','alexandra','irina','dmitry'];
const fixtures=[
 ['TEST-OZ-1','TEST-OZ','Ozon','covers',5],
 ['TEST-OZ-2','TEST-OZ','Ozon','carpets',3],
 ['TEST-WB-1','TEST-WB','ВБ','covers',3],
 ['TEST-AV-1','TEST-AV','Авито','carpets',2],
 ['TEST-PL-1','TEST-PL','Пламя','covers',2]
];
const help='ТЕСТ ПО ЗАКАЗАМ. /test orders — список; /test orders role olga|alexandra|irina|dmitry; /test orders produce|pack ID-позиции количество ID-операции; /test orders handover SHIP-ID ID-позиции количество ID-операции; /test orders accept SHIP-ID ID-операции; /test orders status [ID-позиции].';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const opPattern=/^[A-Za-z][A-Za-z0-9-]{0,47}$/;
const shipPattern=/^SHIP-[A-Za-z0-9-]{1,24}$/;
function initial(){
 return {namespace,session:randomUUID(),role:'olga',positions:fixtures.map(([id,orderId,channel,category,quantity])=>({id,orderId,channel,category,quantity,produced:0,packed:0,handed:0,accepted:0})),shipments:{},operations:{},receipts:{},journal:[]};
}
function validate(s){
 if(!s||s.namespace!==namespace||typeof s.session!=='string'||!roles.includes(s.role)||!Array.isArray(s.positions)||s.positions.length!==fixtures.length||!object(s.shipments)||!object(s.operations)||!object(s.receipts)||!Array.isArray(s.journal)||s.journal.length>2000)throw Error('invalid order sandbox');
 for(let i=0;i<fixtures.length;i++){
  const p=s.positions[i],f=fixtures[i];
  if(!p||[p.id,p.orderId,p.channel,p.category,p.quantity].some((v,j)=>v!==f[j])||![p.produced,p.packed,p.handed,p.accepted].every(Number.isSafeInteger)||p.accepted<0||p.accepted>p.handed||p.handed>p.packed||p.packed>p.produced||p.packed>p.quantity||p.produced>p.quantity+1)throw Error('invalid position balance');
 }
 if(s.positions.reduce((n,p)=>n+p.produced,0)>16)throw Error('invalid fixture production');
 const hand={},accepted={};
 for(const [id,shipment] of Object.entries(s.shipments)){
  if(!shipPattern.test(id)||!shipment||!['prepared','accepted'].includes(shipment.status)||!Array.isArray(shipment.lines)||!shipment.lines.length)throw Error('invalid shipment');
  for(const line of shipment.lines){
   if(!s.positions.some(p=>p.id===line.positionId)||!Number.isSafeInteger(line.quantity)||line.quantity<=0)throw Error('invalid shipment line');
   hand[line.positionId]=(hand[line.positionId]||0)+line.quantity;
   if(shipment.status==='accepted')accepted[line.positionId]=(accepted[line.positionId]||0)+line.quantity;
  }
 }
 for(const p of s.positions)if(p.handed!==(hand[p.id]||0)||p.accepted!==(accepted[p.id]||0))throw Error('shipment balance mismatch');
 if(Object.entries(s.operations).some(([id,op])=>!opPattern.test(id)||!object(op)||typeof op.action!=='string'))throw Error('invalid operations');
}
function describe(s,positionId){
 const selected=positionId?s.positions.filter(p=>p.id===positionId):s.positions;
 return selected.map(p=>`${p.orderId} / ${p.id}: ${p.category==='covers'?'чехлы':'ковры'}, ${p.channel}; заказано ${p.quantity}, изготовлено ${p.produced}, упаковано ${p.packed}, передача ${p.handed}, водитель ${p.accepted}, осталось ${p.produced-p.accepted}`).join('\n')+
  '\nОтгрузки: '+(Object.entries(s.shipments).map(([id,x])=>id+' '+(x.status==='accepted'?'принята водителем':'ждёт водителя')+' ['+x.lines.map(l=>l.positionId+':'+l.quantity).join(', ')+']').join('; ')||'нет')+
  '\nСписание: 0. Приёмка маркетплейсом: неизвестно. Только вымышленные данные.';
}
function apply(s,command){
 const words=command.trim().split(/\s+/),[action]=words;
 const reject=reason=>({status:'rejected',action:'invalid',reason});
 if(!command||action==='status'&&words.length<=2){
  if(words[1]&&!s.positions.some(p=>p.id===words[1]))return reject('неизвестная позиция');
  return {status:'view',action:'status',positionId:words[1]};
 }
 if(action==='role'&&words.length===2&&roles.includes(words[1])){s.role=words[1];return {status:'ok',action:'role '+s.role};}
 let positionId,quantity,shipmentId,operationId,role;
 if(['produce','pack'].includes(action)&&words.length===4){[,positionId,quantity,operationId]=words;role=action==='produce'?'alexandra':'irina';}
 else if(action==='handover'&&words.length===5){[,shipmentId,positionId,quantity,operationId]=words;role='irina';}
 else if(action==='accept'&&words.length===3){[,shipmentId,operationId]=words;role='dmitry';}
 else return reject('неверная команда; каждую команду отправляйте отдельным сообщением');
 if(s.role!==role)return reject('неверная роль; требуется '+role);
 if(!opPattern.test(operationId)||shipmentId&&!shipPattern.test(shipmentId))return reject('неверный ID операции или отгрузки');
 if(Object.hasOwn(s.operations,operationId))return reject('ID операции уже использован: '+operationId);
 const p=s.positions.find(x=>x.id===positionId);
 if(action!=='accept'){
  if(!p)return reject('неизвестная позиция');
  if(!/^[1-9]\d{0,2}$/.test(quantity))return reject('количество должно быть целым положительным числом');
  quantity=Number(quantity);
 }
 if(action==='produce'){
  if(p.produced+quantity>p.quantity+1||s.positions.reduce((n,x)=>n+x.produced,0)+quantity>16)return reject('превышен лимит тестового пошива');
  p.produced+=quantity;
 }else if(action==='pack'){
  if(p.packed+quantity>p.quantity)return reject('упаковка превышает количество заказа');
  if(p.packed+quantity>p.produced)return reject('недостаточно готовых изделий этой позиции');
  p.packed+=quantity;
 }else if(action==='handover'){
  if(p.handed+quantity>p.packed)return reject('недостаточно упакованных изделий этой позиции');
  if(s.shipments[shipmentId]?.status==='accepted')return reject('водитель уже принял отгрузку; создайте новую');
  s.shipments[shipmentId]??={status:'prepared',lines:[]};
  s.shipments[shipmentId].lines.push({positionId,quantity});p.handed+=quantity;
 }else{
  const shipment=s.shipments[shipmentId];
  if(!shipment)return reject('неизвестная отгрузка');
  if(shipment.status==='accepted')return reject('отгрузка уже принята водителем');
  for(const line of shipment.lines)s.positions.find(x=>x.id===line.positionId).accepted+=line.quantity;
  shipment.status='accepted';
 }
 const safeAction=words.join(' ');
 s.operations[operationId]={action:safeAction};
 return {status:'ok',action:safeAction,positionId,shipmentId,operationId,quantity};
}
// Called only after packingTest has checked owner, private dialog, freshness and enabled flag.
export function packingOrders(event,env){
 const dir=env.MAX_PACKING_TEST_DIR;
 mkdirSync(dir,{recursive:true,mode:0o700});
 if(lstatSync(dir).isSymbolicLink())throw Error('unsafe directory');
 const file=join(dir,'packing-orders-v1.json'),temp=join(dir,'packing-orders-v1.tmp'),lock=join(dir,'packing-orders-v1.lock');
 const fd=openSync(lock,'wx',0o600);
 try{
  let s;try{if(lstatSync(file).isSymbolicLink())throw Error('unsafe state');s=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;s=initial();}
  validate(s);
  const key=createHash('sha256').update(event.message.body.mid).digest('hex');
  if(Object.hasOwn(s.receipts,key))return s.receipts[key];
  if(s.journal.length>=2000)throw Error('sandbox capacity');
  const command=event.message.body.text.trim().replace(/^\/test\s+orders\s*/u,'');
  const result=apply(s,command);
  validate(s);
  const id=randomUUID();
  s.journal.push({id,date:new Date().toISOString(),session:s.session,role:s.role,...result});
  const reply={text:(result.status==='rejected'?'ТЕСТ: ОТКАЗ — '+result.reason:result.status==='ok'?'ТЕСТ: ОК — '+result.action:help)+'\n'+describe(s,result.positionId)+'\nСобытие: '+id};
  s.receipts[key]=reply;
  const out=openSync(temp,'wx',0o600);try{writeFileSync(out,JSON.stringify(s));fsyncSync(out);}finally{closeSync(out);}
  renameSync(temp,file);return reply;
 }finally{closeSync(fd);unlinkSync(lock);}
}
