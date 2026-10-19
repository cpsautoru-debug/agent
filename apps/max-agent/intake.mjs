import {createHash,createHmac} from 'node:crypto';
export const hash=text=>createHash('sha256').update(text).digest('hex');
export function parseList(raw){
  if(typeof raw!=='string'||raw.length>10000)throw Error('Список слишком длинный');
  const items=[],issues=[];
  for(const line of raw.split(/\r?\n/u).map(s=>s.trim()).filter(Boolean)){
    if(!/^\d+[.)]/u.test(line)){if(!/^(отгрузки|заявка|чехлы)\s*[^\d]*:$/iu.test(line))issues.push('Не распознана строка: '+line.slice(0,100));continue;}
    const m=line.match(/^(\d+)[.)]\s*(.+?)\s*[-–—]\s*(\d+)\s*(?:шт\.?|комплект(?:ов|а)?)(?=\s|\(|\+|$)(.*)$/iu);
    if(!m||!Number.isSafeInteger(Number(m[3]))||Number(m[3])<1||Number(m[3])>10000){issues.push('Уточните товар и количество: '+line.slice(0,100));continue;}
    if(items.some(p=>p.number===Number(m[1])))issues.push('Повтор номера позиции '+m[1]);
    if(/\+\s*\d/u.test(m[4]))issues.push('Дополнительное изделие в позиции '+m[1]+' нужно вынести отдельной строкой');
    items.push({number:Number(m[1]),title:m[2].trim(),quantity:Number(m[3]),notes:m[4].trim()});
  }
  if(!items.length)issues.push('Нет позиций. Формат: 1) Название — 2 шт. (примечание)');
  if(items.length>50)issues.push('Не более 50 позиций в одной заявке');
  return {items,issues};
}
export function intakeCommand(event,env){
  const m=event?.message;
  if(event?.update_type!=='message_created'||!Number.isFinite(event.timestamp)||Math.abs(Date.now()-event.timestamp)>300000||m?.recipient?.chat_type!=='dialog'||!env.MAX_WORK_CHAT_ID||String(m.sender?.user_id)!==env.MAX_OWNER_ID||m.sender?.is_bot||typeof m.body?.mid!=='string')return null;
  // Legacy chatId identifies the configured bridge workspace, not the event's source chat.
  const text=m.body.text||'';
  const command=text.match(/^(?:\/заявка|\/order|Принять заявку)\s*\n([\s\S]+)$/iu);
  if(command){
    const raw=command[1].trim(),parsed=parseList(raw);
    return {action:'draft',id:hash('dialog:'+env.MAX_OWNER_ID+'\n'+m.body.mid).slice(0,24),chatId:env.MAX_WORK_CHAT_ID,userId:env.MAX_OWNER_ID,messageId:m.body.mid,raw,items:parsed.items,issues:parsed.issues};
  }
  const confirm=text.match(/^\/confirm\s+([a-f0-9]{24})\s+([a-f0-9]{12})\s*$/u);
  return confirm?{action:'confirm',id:confirm[1],expected:confirm[2],chatId:env.MAX_WORK_CHAT_ID,userId:env.MAX_OWNER_ID}:null;
}
export const bridgeConfigured=env=>Boolean(env.SHEETS_BRIDGE_KEY?.length>=32&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/u.test(env.SHEETS_BRIDGE_URL||''));
export async function bridgeRequest(env,data,fetcher=fetch){
  if(!bridgeConfigured(env))return {ok:false,error:'bridge-not-configured'};
  // ASCII wire representation keeps signatures stable across gateway charset decoding.
  // JSON.parse in Apps Script restores the original Cyrillic and surrogate pairs.
  const timestamp=Date.now(),body=JSON.stringify(data).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')),signature=createHmac('sha256',env.SHEETS_BRIDGE_KEY).update(timestamp+'\n'+body).digest('hex');
  try{
    const r=await fetcher(env.SHEETS_BRIDGE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,body,signature}),signal:AbortSignal.timeout(20000)});
    if(!r.ok)return {ok:false,error:'bridge-http-error'};
    const result=await r.json();return result;
  }catch{return {ok:false,error:'bridge-result-unknown'};}
}
export function reviewText(result){
  if(!result.ok)return 'Google Таблица не подтвердила операцию. Не считаю заявку записанной. Повторите ту же команду: проверка ID защитит от дубля.';
  if(result.status==='confirmed')return 'Заявка '+result.id+' подтверждена и записана в лист «Заявки MAX». Это сводная заявка; остатки и списания не менялись.';
  const rows=result.items.map(p=>p.number+') '+p.title+' — '+p.quantity+' шт. '+p.notes);
  const warnings=result.issues?.length?'\nУточнения:\n'+result.issues.join('\n'):'\nПроверьте количество и все примечания. Наличие, производство и запас остаются примечаниями, без складских операций.';
  const confirm=result.issues?.length?'\nИсправьте список и отправьте новой командой «Принять заявку». Предыдущий черновик не подтверждайте.':'\nДля записи отправьте здесь, в личном диалоге с ботом:\n/confirm '+result.id+' '+result.revision;
  const text='Черновик '+result.id+'\n'+rows.join('\n')+warnings+confirm;
  return text.length<=3900?text:'Черновик сохранён, но список слишком длинный для полного показа в MAX. Разбейте его на несколько небольших заявок. Подтверждение обрезанного списка не предлагается.';
}
