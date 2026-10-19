'use strict';
// Browser-local creative workspace. No credentials, remote publication, or fabricated metrics.
const STUDIO_KEY='autosklad63-studio-v1';
const vkCommunity='https://vk.ru/autosklad63';
let studioTasks=[];
try{const saved=JSON.parse(localStorage.getItem(STUDIO_KEY)||'[]');if(Array.isArray(saved))studioTasks=saved.filter(t=>t&&typeof t.id==='string'&&typeof t.title==='string'&&typeof t.text==='string'&&['brief','design','approved'].includes(t.stage)).slice(0,50);}catch{}
let studioPhoto=null,studioPhotoUrl=null,studioSelected=null;
const studioCanvas=document.querySelector('#designCanvas');
const studioCtx=studioCanvas.getContext('2d');
const studioMessage=text=>document.querySelector('#studioMessage').textContent=text;
function saveStudio(){try{localStorage.setItem(STUDIO_KEY,JSON.stringify(studioTasks));return true;}catch{studioMessage('Не удалось сохранить в браузере. Освободите место или скачайте бриф.');return false;}}
function paintWrapped(text,x,y,width,lineHeight,maxLines){
 const words=String(text).split(/\s+/);let line='',lines=[];
 for(const word of words){const next=line?line+' '+word:word;if(studioCtx.measureText(next).width>width&&line){lines.push(line);line=word;}else line=next;}
 if(line)lines.push(line);
 lines=lines.slice(0,maxLines);for(let i=0;i<lines.length;i++){let line=lines[i];while(studioCtx.measureText(line).width>width&&line.length)line=line.slice(0,-1);studioCtx.fillText(line,x,y+i*lineHeight);}
}
function renderDesign(){
 const portrait=document.querySelector('#designFormat').value==='portrait';studioCanvas.width=1080;studioCanvas.height=portrait?1350:1080;
 const h=studioCanvas.height,photoHeight=h-345;
 studioCtx.fillStyle='#193c32';studioCtx.fillRect(0,0,1080,h);
 if(studioPhoto){const scale=Math.min(1080/studioPhoto.width,photoHeight/studioPhoto.height),w=studioPhoto.width*scale,ph=studioPhoto.height*scale;studioCtx.fillStyle='#edf0e8';studioCtx.fillRect(0,0,1080,photoHeight);studioCtx.drawImage(studioPhoto,(1080-w)/2,(photoHeight-ph)/2,w,ph);}
 else{studioCtx.fillStyle='#e8eee5';studioCtx.fillRect(0,0,1080,photoHeight);studioCtx.fillStyle='#748477';studioCtx.font='500 32px Arial';studioCtx.fillText('Загрузите реальное фото товара',70,photoHeight/2);}
 studioCtx.fillStyle='#d5ed9b';studioCtx.font='700 25px Arial';studioCtx.fillText('АВТОСКЛАД63 · ТОВАРЫ ДЛЯ АВТО',64,photoHeight+57);
 studioCtx.fillStyle='#ffffff';studioCtx.font='700 54px Arial';paintWrapped(document.querySelector('#designTitle').value||'Ваш товар — в деталях',64,photoHeight+126,950,64,2);
 studioCtx.fillStyle='#dce7da';studioCtx.font='400 29px Arial';paintWrapped(document.querySelector('#designSubtitle').value||'Подберём вариант для вашего автомобиля',64,photoHeight+270,950,39,1);
 document.querySelector('#downloadDesign').disabled=!studioPhoto;
}
const stageName={brief:'Бриф',design:'Макет готов',approved:'Готово для ВК'};
function renderStudio(){
 document.querySelector('#studioQueue').innerHTML=studioTasks.length?studioTasks.map(t=>`<article class="studio-task"><span class="badge ${t.stage==='approved'?'ready':''}">${stageName[t.stage]}</span><h3>${escapeHTML(t.title)}</h3><p>${escapeHTML(t.text.slice(0,150))}${t.text.length>150?'…':''}</p><small>Ответственный: ${t.stage==='brief'?'Дизайнер':t.stage==='design'?'Проверка условий':'ВК-агент · ожидает API'}</small><button class="button" type="button" data-studio-task="${escapeHTML(t.id)}">Открыть материал →</button></article>`).join(''):'<div class="empty-state">Создайте первый бриф. Здесь появятся материалы и следующий ответственный.</div>';
 document.querySelector('#studioCount').textContent=String(studioTasks.length);
}
document.querySelector('#studioBrief').addEventListener('submit',event=>{
 event.preventDefault();const title=document.querySelector('#briefTitle').value.trim(),text=document.querySelector('#briefText').value.trim();if(!title||!text)return;
 if(studioTasks.length>=50){studioMessage('В браузере уже 50 материалов. Экспортируйте завершённые брифы.');return;}
 const task={id:crypto.randomUUID(),title,text,stage:'brief',created:new Date().toISOString()};studioTasks.unshift(task);saveStudio();renderStudio();selectStudioTask(task.id);studioMessage('Бриф создан. Загрузите фото и скачайте макет PNG.');
});
function selectStudioTask(id){
 const task=studioTasks.find(t=>t.id===id);if(!task)return;studioSelected=id;
 studioPhoto=null;if(studioPhotoUrl){URL.revokeObjectURL(studioPhotoUrl);studioPhotoUrl=null;}
 document.querySelector('#designPhoto').value='';
 document.querySelector('#selectedBrief').textContent=task.title;document.querySelector('#postCopy').value=task.text;document.querySelector('#designTitle').value=task.title.slice(0,70);
 document.querySelector('#termsChecked').checked=false;document.querySelector('#photoChecked').checked=false;
 document.querySelector('#approveCreative').disabled=task.stage==='brief';renderDesign();
}
document.querySelector('#studioQueue').addEventListener('click',event=>{const button=event.target.closest('[data-studio-task]');if(button)selectStudioTask(button.dataset.studioTask);});
document.querySelector('#designPhoto').addEventListener('change',event=>{
 const file=event.target.files[0];if(!file)return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024){studioMessage('Выберите JPG, PNG или WebP до 12 МБ.');return;}
 if(studioPhotoUrl)URL.revokeObjectURL(studioPhotoUrl);studioPhotoUrl=URL.createObjectURL(file);const img=new Image();
 img.onload=()=>{studioPhoto=img;renderDesign();studioMessage('Фото загружено только в этот браузер. На сервер оно не отправляется.');};img.onerror=()=>studioMessage('Не удалось открыть изображение.');img.src=studioPhotoUrl;
});
function invalidateCreative(){const task=studioTasks.find(t=>t.id===studioSelected);if(task&&task.stage!=='brief'){task.stage='brief';delete task.checked;saveStudio();renderStudio();document.querySelector('#approveCreative').disabled=true;document.querySelector('#termsChecked').checked=false;document.querySelector('#photoChecked').checked=false;studioMessage('Материал изменён. Скачайте новый макет и повторите проверку.');}}
['designTitle','designSubtitle','designFormat'].forEach(id=>document.querySelector('#'+id).addEventListener('input',()=>{invalidateCreative();renderDesign();}));
document.querySelector('#designPhoto').addEventListener('change',invalidateCreative);
document.querySelector('#postCopy').addEventListener('input',invalidateCreative);
document.querySelector('#downloadDesign').addEventListener('click',()=>{
 if(!studioPhoto)return;renderDesign();studioCanvas.toBlob(blob=>{if(!blob){studioMessage('Не удалось создать PNG.');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='autosklad63-'+(studioSelected||'design')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
 const task=studioTasks.find(t=>t.id===studioSelected);if(task){task.stage='design';task.text=document.querySelector('#postCopy').value.trim();saveStudio();renderStudio();document.querySelector('#approveCreative').disabled=false;}studioMessage('PNG подготовлен. Проверьте изображение, текст, цену и условия перед передачей в ВК.');},'image/png');
});
document.querySelector('#approveCreative').addEventListener('click',()=>{
 const task=studioTasks.find(t=>t.id===studioSelected);if(!task)return;
 if(!document.querySelector('#termsChecked').checked||!document.querySelector('#photoChecked').checked){studioMessage('Подтвердите проверку условий и права на фото.');return;}
 const text=document.querySelector('#postCopy').value.trim();if(!text){studioMessage('Добавьте текст поста.');return;}
 task.text=text;task.stage='approved';task.checked=new Date().toISOString();saveStudio();renderStudio();studioMessage('Материал готов для ВК. Автопубликация ещё не подключена: токен сообщества не настроен.');
});
document.querySelector('#copyCreative').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.querySelector('#postCopy').value);studioMessage('Текст скопирован.');}catch{studioMessage('Выделите и скопируйте текст из поля поста.');}});
document.querySelector('#exportBrief').addEventListener('click',()=>{
 const task=studioTasks.find(t=>t.id===studioSelected);if(!task){studioMessage('Сначала выберите бриф.');return;}
 const blob=new Blob([JSON.stringify({...task,community:vkCommunity,publication:'not-published'},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='brief-'+task.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
});
renderStudio();renderDesign();
