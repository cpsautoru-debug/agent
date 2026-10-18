// Standalone bridge. Google authorization is required; code fixes one workbook ID.
var MAX_BRIDGE_BOOK='11Qb-AR6nlR-Yt89Pu8nviqAud7h6Hrmba4gNEXU47Q4';
var MAX_QUEUE_HEADERS=['ID заявки','Создано','Статус','Версия','Данные JSON','Первое сообщение'];
var MAX_ROWS_HEADERS=['ID заявки','Подтверждено','Позиция','Товар / вариант','Количество, шт.','Примечание источника','Источник MAX','Тип записи'];
function maxBridgeJson_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return maxBridgeJson_({service:'MAX Sheets bridge',private:true});}
function maxBridgeHex_(bytes){return bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function maxBridgeHash_(text){return maxBridgeHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8));}
function maxBridgeEqual_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;var value=0;for(var i=0;i<a.length;i++)value|=a.charCodeAt(i)^b.charCodeAt(i);return value===0;}
function maxBridgeSheet_(book,name,headers){
  var sheet=book.getSheetByName(name);
  if(!sheet){sheet=book.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#eaf0e4');sheet.setColumnWidths(1,headers.length,160);sheet.getRange(1,1,sheet.getMaxRows(),headers.length).setWrap(true);}
  if(sheet.getRange(1,1,1,headers.length).getValues()[0].join('|')!==headers.join('|'))throw Error('schema-mismatch');
  if(sheet.getLastRow()>5000)throw Error('capacity-limit');return sheet;
}
function maxBridgeSafe_(value){return typeof value==='string'&&/^[=+@-]/.test(value)?"'"+value:value;}
function maxBridgeCapacity_(sheet,last){if(last>5000)throw Error('capacity-limit');if(last>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),last-sheet.getMaxRows());}
function maxBridgeValidate_(d,p){
  if(!d||!['draft','confirm','ping'].includes(d.action))throw Error('bad-action');
  if(d.action==='ping')return;
  if(!/^[a-f0-9]{24}$/.test(d.id||'')||d.chatId!==p.getProperty('MAX_WORK_CHAT_ID')||d.userId!==p.getProperty('MAX_OWNER_ID'))throw Error('forbidden-source');
  if(d.action==='confirm'){if(!/^[a-f0-9]{12}$/.test(d.expected||''))throw Error('bad-revision');return;}
  if(typeof d.raw!=='string'||d.raw.length>10000||!Array.isArray(d.items)||d.items.length>50||!Array.isArray(d.issues)||d.issues.length>100||typeof d.messageId!=='string'||d.messageId.length>300)throw Error('bad-draft');
  d.items.forEach(function(i){if(!Number.isSafeInteger(i.number)||i.number<1||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>10000||typeof i.title!=='string'||!i.title||i.title.length>1000||typeof i.notes!=='string'||i.notes.length>3000)throw Error('bad-item');});
}
function maxBridgeProcess_(d,p){
  maxBridgeValidate_(d,p);
  var book=SpreadsheetApp.openById(MAX_BRIDGE_BOOK);
  if(d.action==='ping')return {ok:true,spreadsheetMatches:book.getId()===MAX_BRIDGE_BOOK};
  var queue=maxBridgeSheet_(book,'MAX — очередь',MAX_QUEUE_HEADERS);
  var existing=queue.getLastRow()>1?queue.getRange(2,1,queue.getLastRow()-1,6).getValues():[];
  var index=existing.findIndex(function(r){return r[0]===d.id;});
  if(d.action==='draft'){
    if(index<0)index=existing.findIndex(function(r){return Date.now()-new Date(r[1]).getTime()<86400000&&JSON.parse(r[4]).raw===d.raw;});
    if(index>=0){var prior=existing[index];var saved=JSON.parse(prior[4]);return {ok:true,id:prior[0],status:prior[2],revision:prior[3],items:saved.items,issues:saved.issues};}
    var data=JSON.stringify({raw:d.raw,items:d.items,issues:d.issues});var revision=maxBridgeHash_(data).slice(0,12);
    maxBridgeCapacity_(queue,queue.getLastRow()+1);queue.getRange(queue.getLastRow()+1,1,1,6).setValues([[d.id,new Date(),'draft',revision,data,maxBridgeSafe_(d.messageId)]]);SpreadsheetApp.flush();
    return {ok:true,id:d.id,status:'draft',revision:revision,items:d.items,issues:d.issues};
  }
  if(index<0)throw Error('draft-not-found');var row=existing[index];
  if(String(row[3])!==d.expected)throw Error('stale-revision');
  var payload=JSON.parse(row[4]);if(!payload.items.length||payload.issues.length)throw Error('clarification-required');
  var output=maxBridgeSheet_(book,'Заявки MAX',MAX_ROWS_HEADERS);
  var all=output.getLastRow()>1?output.getRange(2,1,output.getLastRow()-1,8).getValues():[];
  var found=all.filter(function(r){return r[0]===d.id;});
  var notes=payload.items.map(function(item){return [d.id,new Date(),item.number,maxBridgeSafe_(item.title),item.quantity,maxBridgeSafe_(item.notes),maxBridgeSafe_(row[5]),'Сводная заявка; без списания'];});
  if(found.length){
    if(found.length!==notes.length||found.some(function(r,i){return r[2]!==payload.items[i].number||r[3]!==payload.items[i].title||r[4]!==payload.items[i].quantity||r[5]!==payload.items[i].notes;}))throw Error('partial-or-changed-record');
  }else{
    if(row[2]==='confirmed')throw Error('confirmed-rows-missing');
    if(output.getLastRow()+notes.length>5000)throw Error('capacity-limit');
    maxBridgeCapacity_(output,output.getLastRow()+notes.length);output.getRange(output.getLastRow()+1,1,notes.length,8).setValues(notes);SpreadsheetApp.flush();
  }
  queue.getRange(index+2,3).setValue('confirmed');SpreadsheetApp.flush();return {ok:true,id:d.id,status:'confirmed'};
}
function doPost(e){
  try{
    if(!e||!e.postData||e.postData.contents.length>40000)throw Error('bad-request');
    var envelope=JSON.parse(e.postData.contents),p=PropertiesService.getScriptProperties(),key=p.getProperty('MAX_BRIDGE_KEY');
    if(!key||key.length<32||typeof envelope.body!=='string'||!Number.isFinite(envelope.timestamp)||Math.abs(Date.now()-envelope.timestamp)>300000)throw Error('unauthorized');
    var signature=maxBridgeHex_(Utilities.computeHmacSha256Signature(envelope.timestamp+'\n'+envelope.body,key));
    if(!maxBridgeEqual_(signature,envelope.signature))throw Error('unauthorized');
    var d=JSON.parse(envelope.body),lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw Error('busy');
    try{return maxBridgeJson_(maxBridgeProcess_(d,p));}finally{lock.releaseLock();}
  }catch(error){var safe=['bad-request','unauthorized','bad-action','forbidden-source','bad-revision','bad-draft','bad-item','schema-mismatch','capacity-limit','draft-not-found','stale-revision','clarification-required','partial-or-changed-record','confirmed-rows-missing','busy'];return maxBridgeJson_({ok:false,error:safe.indexOf(String(error.message))>=0?error.message:'bridge-failed'});}
}
function prepareMaxBridge(){
  var book=SpreadsheetApp.openById(MAX_BRIDGE_BOOK);if(book.getId()!==MAX_BRIDGE_BOOK)throw Error('Неверная рабочая таблица');
  var p=PropertiesService.getScriptProperties();if(!p.getProperty('MAX_BRIDGE_KEY'))p.setProperty('MAX_BRIDGE_KEY',Utilities.getUuid()+Utilities.getUuid());
  console.log('Ключ моста создан в свойствах скрипта. Укажите там MAX_OWNER_ID и MAX_WORK_CHAT_ID. Значения не публикуются.');
}
