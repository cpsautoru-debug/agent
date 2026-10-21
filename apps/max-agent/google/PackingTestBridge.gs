// STANDALONE TEST-ONLY Apps Script project. Do not paste into production bridge.
var PACKING_TEST_BOOK='1x3B-6sdabZNNHCpy8la7Oqwgja7yBjU1G0n1ku0kMoI';
var PACKING_EVENT_HEADERS=['ID события','Время','Источник','Роль','Действие','ID заказа','ID позиции','Количество','ID отгрузки','Результат','ID операции','Комментарий'];
var PACKING_BALANCE_HEADERS=['ID позиции','ID заказа','Заказано','Изготовлено','Упаковано','Передано','Принято водителем','Остаток','Ошибки сверки','Последнее событие'];
var PACKING_FIXTURES=[['TEST-OZ-1','TEST-OZ',5],['TEST-OZ-2','TEST-OZ',3],['TEST-WB-1','TEST-WB',3],['TEST-AV-1','TEST-AV',2],['TEST-PL-1','TEST-PL',2]];
function packingJson_(x){return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return packingJson_({service:'synthetic-packing-only'});}
function packingHex_(bytes){return bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function packingEq_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;var n=0;for(var i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function packingSheet_(book,name,headers){var s=book.getSheetByName(name);if(!s)throw Error('missing-test-sheet');if(s.getRange(1,1,1,headers.length).getValues()[0].join('|')!==headers.join('|'))throw Error('schema-mismatch');return s;}
function packingSafe_(x){return typeof x==='string'&&/^[=+@-]/.test(x)?"'"+x:x;}
function packingApply_(e){
 if(!e||typeof e.id!=='string'||e.id.length>120||!/^[a-f0-9-]{36}:[a-f0-9-]{36}$/.test(e.id)||!['produce','pack','handover','accept'].includes(e.action)||!['alexandra','irina','dmitry'].includes(e.role)||!/^([A-Za-z][A-Za-z0-9-]{0,47})$/.test(e.operationId||'')||!Number.isSafeInteger(e.quantity)||e.quantity<0||e.quantity>16||typeof e.date!=='string'||isNaN(Date.parse(e.date)))throw Error('bad-test-event');
 var allowed={produce:'alexandra',pack:'irina',handover:'irina',accept:'dmitry'};if(allowed[e.action]!==e.role)throw Error('bad-test-role');
 var fixture=PACKING_FIXTURES.filter(function(x){return x[0]===e.positionId;})[0];
 if(e.action!=='accept'&&(!fixture||e.orderId!==fixture[1]||e.quantity<1))throw Error('bad-test-position');
 if(e.action==='accept'&&(e.positionId!==''||e.orderId!==''||e.quantity!==0))throw Error('bad-test-accept');
 if(['accept','handover'].includes(e.action)?!/^SHIP-[A-Za-z0-9-]{1,24}$/.test(e.shipmentId||''):e.shipmentId!=='')throw Error('bad-test-shipment');
 var book=SpreadsheetApp.openById(PACKING_TEST_BOOK),events=packingSheet_(book,'MAX тест — события',PACKING_EVENT_HEADERS),balance=packingSheet_(book,'MAX тест — сверка',PACKING_BALANCE_HEADERS);
 var last=events.getLastRow();if(last>2000)throw Error('capacity-limit');
 var rows=last>1?events.getRange(2,1,last-1,12).getValues():[];
 var already=rows.some(function(r){return r[0]===e.id;});
 if(!already&&rows.some(function(r){return r[10]===e.operationId;}))throw Error('operation-reused');
 // Rebuild all synthetic balances from the immutable event journal; never touch business tabs.
 var next=rows.map(function(r){return r.slice();});
 if(!already)next.push([e.id,e.date,'MAX TEST',e.role,e.action,e.orderId,e.positionId,e.quantity,e.shipmentId,'Принято',e.operationId,'Синтетическое событие']);
 var positions={};PACKING_FIXTURES.forEach(function(f){positions[f[0]]={id:f[0],order:f[1],ordered:f[2],produced:0,packed:0,handed:0,accepted:0,last:''};});
 var shipments={};
 next.forEach(function(r){var act=r[4],id=r[6],qty=Number(r[7]),ship=r[8],p=positions[id];
  if(!['produce','pack','handover','accept'].includes(act)||!Number.isSafeInteger(qty)||qty<0)throw Error('invalid-test-history');
  if(act==='accept'){
   if(!shipments[ship]||shipments[ship].accepted)throw Error('shipment-not-prepared');
   shipments[ship].accepted=true;shipments[ship].lines.forEach(function(l){positions[l.id].accepted+=l.qty;positions[l.id].last=r[0];});return;
  }
  if(!p)throw Error('invalid-test-history');
  if(act==='produce'){p.produced+=qty;if(p.produced>p.ordered+1)throw Error('overproduction');}
  if(act==='pack'){p.packed+=qty;if(p.packed>p.produced||p.packed>p.ordered)throw Error('overpacking');}
  if(act==='handover'){
   if(shipments[ship]&&shipments[ship].accepted)throw Error('shipment-already-accepted');
   p.handed+=qty;if(p.handed>p.packed)throw Error('overhandover');
   if(!shipments[ship])shipments[ship]={accepted:false,lines:[]};shipments[ship].lines.push({id,qty});
  }
  p.last=r[0];
 });
 var total=Object.keys(positions).reduce(function(n,k){return n+positions[k].produced;},0);if(total>16)throw Error('overproduction');
 Object.keys(positions).forEach(function(k){var p=positions[k];if(p.accepted>p.handed)throw Error('overaccept');});
 var output=PACKING_FIXTURES.map(function(f){var p=positions[f[0]];return [p.id,p.order,p.ordered,p.produced,p.packed,p.handed,p.accepted,p.produced-p.accepted,'',p.last];});
 // Append first, then rebuild balance. Retries will repair the balance if a partial failure occurs.
 if(!already){events.getRange(last+1,1,1,12).setValues([next[next.length-1].map(packingSafe_)]);SpreadsheetApp.flush();}
 balance.getRange(2,1,output.length,10).setValues(output.map(function(row){return row.map(packingSafe_);}));SpreadsheetApp.flush();
 return {ok:true,duplicate:already};
}
function doPost(request){
 try{
  if(!request||!request.postData||!request.postData.contents||request.postData.contents.length>12000)throw Error('bad-request');
  var env=JSON.parse(request.postData.contents),key=PropertiesService.getScriptProperties().getProperty('MAX_TEST_SHEETS_KEY');
  if(!key||key.length<32||typeof env.body!=='string'||!Number.isFinite(env.timestamp)||Math.abs(Date.now()-env.timestamp)>300000)throw Error('unauthorized');
  var signature=packingHex_(Utilities.computeHmacSha256Signature(env.timestamp+'\n'+env.body,key));if(!packingEq_(signature,env.signature))throw Error('unauthorized');
  var data=JSON.parse(env.body);if(data.action!=='test-event')throw Error('bad-action');
  var lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw Error('busy');
  try{return packingJson_(packingApply_(data.event));}finally{lock.releaseLock();}
 }catch(error){return packingJson_({ok:false,error:['unauthorized','bad-request','bad-action','bad-test-event','bad-test-role','bad-test-position','bad-test-accept','bad-test-shipment','missing-test-sheet','schema-mismatch','operation-reused','capacity-limit','invalid-test-history','shipment-not-prepared','shipment-already-accepted','overproduction','overpacking','overhandover','overaccept','busy'].includes(error.message)?error.message:'test-bridge-failed'});}
}
