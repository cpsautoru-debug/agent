let key='',snapshot=null,busy=false;
const $=s=>document.querySelector(s);
const el=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const labels={queued:'Ожидает обработки',processing:'Готовится ответ',draft:'Черновик',sent:'Отправлено',rejected:'Отклонено',superseded:'Неактуально',expired:'Срок ответа истёк',handoff:'Нужно участие Антона',failed:'Ошибка отправки',uncertain:'Результат отправки неизвестен'};
async function api(route,body){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Не удалось выполнить действие');return data;}
async function act(fn){if(busy)return;busy=true;$('#notice').textContent='';try{await fn();}catch(e){$('#notice').textContent=e.message;}finally{busy=false;}}
async function load(){snapshot=await api('state');$('#login').hidden=true;$('#app').hidden=false;render();}
function render(){
 const c=snapshot.config;$('#status').replaceChildren(...[c.metaReady?'Meta: параметры заполнены, связь требует проверки':'Meta: не подключена',c.model?'ИИ: '+c.model+' (подключение требует проверки)':'ИИ: не настроен',c.allowSend?'Отправка разрешена':'Отправка выключена',c.paused?'Общая пауза':c.autoReply?'Типовые автоответы включены':'Режим черновиков'].map(x=>el('span',x)));
 $('#details').textContent=`Попыток отправки сегодня: ${c.todayCount} из ${c.dailyLimit}. Дневной лимит считается по UTC.`;$('#pause').textContent=c.paused?'Снять общую паузу':'Приостановить всё';
 const list=$('#events');list.replaceChildren();if(!snapshot.events.length)list.append(el('p','Пока нет входящих. Проверьте помощника тестовым вопросом.','muted'));
 for(const event of snapshot.events){const card=el('article',undefined,'event');card.append(el('small',`${event.simulated?'ТЕСТ · ':''}${event.kind==='dm'?'Директ':'Комментарий'} · ${new Date(event.createdAt).toLocaleString('ru-RU')} · ${labels[event.status]||event.status}`),el('p',event.text));
  if(event.reason)card.append(el('p',event.reason,event.needsHuman?'warn':'muted'));
  if(event.error)card.append(el('p',event.error,'warn'));
  if(event.draft){const label=el('label','Ответ помощника');const box=el('textarea');box.value=event.approvedText||event.draft;box.maxLength=1000;box.setAttribute('aria-label','Ответ на сообщение');label.append(box);card.append(label);
   const actions=el('div',undefined,'actions');
   if(event.status==='draft'){
    const reject=el('button','Отклонить','secondary');reject.onclick=()=>act(async()=>{await api('reject',{id:event.id});await load();});actions.append(reject);
    if(!event.simulated&&c.allowSend){const send=el('button','Отправить в Instagram');send.onclick=()=>act(async()=>{if(!confirm('Отправить этот ответ клиенту в Instagram?'))return;await api('send',{id:event.id,text:box.value});await load();});actions.append(send);}
   }
   if(!event.simulated&&snapshot.threads[event.thread]){const paused=snapshot.threads[event.thread].paused;const pause=el('button',paused?'Вернуть диалог помощнику':'Взять диалог себе','secondary');pause.onclick=()=>act(async()=>{await api('pause',{thread:event.thread,paused:!paused});await load();});actions.append(pause);}
   card.append(actions);
  }list.append(card);
 }
}
$('#loginForm').onsubmit=e=>{e.preventDefault();act(async()=>{key=$('#key').value.trim();await load();$('#key').value='';});};
$('#simulate').onsubmit=e=>{e.preventDefault();act(async()=>{await api('simulate',{text:$('#text').value,kind:$('#kind').value});await load();});};
$('#pause').onclick=()=>act(async()=>{await api('pause',{paused:!snapshot.config.paused});await load();});
$('#refresh').onclick=()=>act(load);
// The launch script passes the local admin key in the URL fragment, never a query or external request.
if(location.hash.startsWith('#key=')){try{key=decodeURIComponent(location.hash.slice(5));history.replaceState(null,'',location.pathname);act(load);}catch{$('#notice').textContent='Не удалось прочитать ключ';}}
