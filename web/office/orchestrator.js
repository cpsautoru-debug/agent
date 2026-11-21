(() => {
  'use strict';
  const root=document.getElementById('orchestratorPanel');
  if(!root)return;
  const form=document.getElementById('orchestratorForm');
  const input=document.getElementById('orchestratorQuestion');
  const send=document.getElementById('orchestratorSend');
  const status=document.getElementById('orchestratorStatus');
  const answer=document.getElementById('orchestratorAnswer');
  const sources=document.getElementById('orchestratorSources');
  const setStatus=text=>{status.textContent=text;};
  let busy=false;
  async function check() {
    if(location.hash.split('/')[0]!=='#orchestrator'||busy)return;
    try{
      const res=await fetch('/api/orchestrator/chat',{
        credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)
      });
      const data=await res.json().catch(()=>({}));
      if(res.status===401){setStatus('Сначала войдите в офис через Google.');return;}
      if(res.status===403){setStatus('Доступ разрешён только владельцу.');return;}
      if(!res.ok){setStatus('Проверка подключения недоступна.');return;}
      setStatus(data.enabled
        ?'Оркестратор подключён · только чтение · WB и Ozon'
        :'Сервер готов. Для ответов требуется секрет OPENAI_API_KEY в Cloudflare.');
    }catch{setStatus('Нет связи с сервисом Оркестратора.');}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    const message=input.value.trim();
    if(!message||message.length>900){
      setStatus('Введите вопрос до 900 символов.');return;
    }
    busy=true;send.disabled=true;input.disabled=true;
    answer.textContent='';sources.textContent='';
    setStatus('Читаю доступные финансовые источники…');
    try{
      const res=await fetch('/api/orchestrator/chat',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({message}),signal:AbortSignal.timeout(35000)
      });
      const body=await res.json().catch(()=>({}));
      if(typeof body.answer==='string')answer.textContent=body.answer;
      if(Array.isArray(body.sources))
        sources.textContent=body.sources.map(s=>s.source+': '+s.status).join(' · ');
      if(res.ok){
        setStatus(body.code==='source_not_connected'
          ?'Этот источник ещё не подключён.'
          :'Ответ подготовлен · только чтение · без изменений в учёте');
      }else{
        const messages={
          openai_key_not_configured:'Не настроен OPENAI_API_KEY в Cloudflare.',
          owner_login_required:'Необходимо войти через Google.',
          owner_only:'Этот раздел доступен только владельцу.',
          all_sources_unavailable:'Финансовые источники недоступны: ответ не сформирован.',
          openai_quota_exhausted:'Недостаточно средств или превышен лимит OpenAI API. Проверьте Billing на platform.openai.com.',
          openai_rate_limited:'Временный лимит запросов OpenAI API. Повторите позже.',
          openai_key_rejected:'OpenAI отклонил API-ключ. Проверьте секрет OPENAI_API_KEY в Cloudflare.',
          openai_permission_denied:'Недостаточно прав API-ключа или проекта OpenAI.',
          openai_model_unavailable:'Выбранная модель недоступна для проекта OpenAI. Проверьте OPENAI_ORCHESTRATOR_MODEL.',
          openai_request_rejected:'OpenAI отклонил параметры запроса. Требуется проверка интеграции.',
          openai_endpoint_unavailable:'Адрес OpenAI API недоступен. Требуется проверка интеграции.',
          openai_service_error:'Сбой серверов OpenAI API. Повторите позднее.',
          llm_unavailable:'Не удалось получить ответ OpenAI: причина пока не определена.',
          payload_too_large:'Запрос слишком длинный.'
        };
        setStatus(messages[body.code]||'Не удалось выполнить запрос. Код: '+(body.code||res.status));
      }
    }catch{setStatus('Время ожидания ответа истекло или нет связи.');}
    finally{busy=false;send.disabled=false;input.disabled=false;}
  });
  window.addEventListener('hashchange',()=>{void check();});
  void check();
})();
