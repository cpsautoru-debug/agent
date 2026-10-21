/**
 * @OnlyCurrentDoc
 * АвтоСклад63: проверки по правилам, без внешней ИИ-модели.
 * Читает рабочие листы; пишет только три служебных листа модуля.
 */
var OFFICE_CONFIG = {
  spreadsheetId: '11Qb-AR6nlR-Yt89Pu8nviqAud7h6Hrmba4gNEXU47Q4',
  maxRows: 5000,
  reportSheet: 'Отчёты контролёров',
  logSheet: 'Журнал контролёров',
  stateSheet: 'Состояние контролёров',
  reportHeaders: ['ID запуска', 'Проверено', 'Роль', 'Уровень', 'Код', 'Источник', 'Описание', 'Следующее действие'],
  logHeaders: ['ID запуска', 'Время', 'Роль', 'Результат', 'Замечаний', 'Время, мс', 'Сообщение'],
  stateHeaders: ['Роль', 'Последний запуск', 'Результат', 'Замечаний', 'ID запуска', 'Режим']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('АвтоСклад63 — контроль')
    .addItem('Проверить продажи, склад и финансы', 'runOfficeAgents')
    .addToUi();
}

function runOfficeAgents() {
  var lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(1000)) throw new Error('Проверка уже выполняется. Повторите позднее.');
  try {
    var book = SpreadsheetApp.getActiveSpreadsheet();
    if (!book || book.getId() !== OFFICE_CONFIG.spreadsheetId) throw new Error('Модуль установлен не в рабочую таблицу АвтоСклад63.');
    var report = officeOutput_(book, OFFICE_CONFIG.reportSheet, OFFICE_CONFIG.reportHeaders);
    var log = officeOutput_(book, OFFICE_CONFIG.logSheet, OFFICE_CONFIG.logHeaders);
    var state = officeOutput_(book, OFFICE_CONFIG.stateSheet, OFFICE_CONFIG.stateHeaders);
    if (log.getLastRow() > 10000) throw new Error('Журнал достиг 10000 строк. Сначала архивируйте журнал вручную.');
    var runId = Utilities.getUuid();
    var now = new Date();
    var today = Utilities.formatDate(now, book.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    var specs = [
      {name: 'Менеджер продаж', evaluate: function() {return officeSalesAll_(book, today, function(d) {return officeDay_(d, book.getSpreadsheetTimeZone());});}},
      {name: 'Кладовщик', evaluate: function() {return officeStock_(officeRead_(book, 'Остаток', 7));}},
      {name: 'Финансовый управляющий', evaluate: function() {return officeFinanceAll_(book);}}
    ];
    var reports = [], logs = [], states = [];
    specs.forEach(function(spec) {
      var started = Date.now(), result = 'Успешно', message = '', issues = [];
      try {issues = spec.evaluate();} catch (error) {
        result = 'Ошибка'; message = String(error.message || error).slice(0, 500);
        issues = [{level:'Ошибка',code:'SOURCE_ERROR',source:'Источник роли',description:message,action:'Проверить структуру листа и доступ; повторить проверку.'}];
      }
      issues.forEach(function(issue) {reports.push([runId, now, spec.name, issue.level, issue.code, issue.source, issue.description, issue.action]);});
      if (!issues.length) reports.push([runId, now, spec.name, 'Информация', 'NO_ISSUES', '', 'В проверенных данных замечаний по правилам не найдено.', 'Это не подтверждает физические остатки и полноту себестоимости.']);
      logs.push([runId, now, spec.name, result, issues.length, Date.now()-started, message]);
      states.push([spec.name, now, result, issues.length, runId, 'Проверки по правилам; не LLM']);
    });
    // Snapshot and log are associated by runId. Never report success before writes complete.
    officeSnapshot_(report, reports, OFFICE_CONFIG.reportHeaders.length);
    officeAppend_(log, logs, OFFICE_CONFIG.logHeaders.length);
    officeSnapshot_(state, states, OFFICE_CONFIG.stateHeaders.length);
    SpreadsheetApp.flush();
    book.toast('Проверены 3 роли. Результаты — «Отчёты контролёров».', 'АвтоСклад63', 8);
    return {runId:runId, roles:states.length, issues:reports.filter(function(r){return r[4] !== 'NO_ISSUES';}).length};
  } finally {lock.releaseLock();}
}

function officeRead_(book, name, width) {
  var sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('Отсутствует лист: ' + name);
  var count = sheet.getLastRow();
  if (count > OFFICE_CONFIG.maxRows) throw new Error('Лист ' + name + ' превышает лимит ' + OFFICE_CONFIG.maxRows + ' строк; проверка не усечена, а остановлена.');
  if (sheet.getMaxColumns() < width) throw new Error('Недостаточно столбцов: ' + name);
  return sheet.getRange(1, 1, Math.max(1,count), width).getValues();
}

function officeOutput_(book, name, headers) {
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() > 0) {
    var actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
    if (actual.join('|') !== headers.join('|')) throw new Error('Служебный лист ' + name + ' содержит другую структуру. Данные не перезаписаны.');
  } else {
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.getRange(1,1,1,headers.length).setBackground('#eaf0e4').setFontWeight('bold').setWrap(true);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, headers.length, 160);
  }
  return sheet;
}

function officeCapacity_(sheet, rows) {
  if (rows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows-sheet.getMaxRows());
}
function officeSafe_(rows) {
  return rows.map(function(row){return row.map(function(v){return typeof v === 'string' && /^[=+@-]/.test(v) ? "'"+v : v;});});
}
function officeSnapshot_(sheet, rows, width) {
  var previous = sheet.getLastRow();
  officeCapacity_(sheet, rows.length+1);
  if (rows.length) sheet.getRange(2,1,rows.length,width).setValues(officeSafe_(rows)).setWrap(true);
  if (previous > rows.length+1) sheet.getRange(rows.length+2,1,previous-rows.length-1,width).clearContent();
  if (rows.length) sheet.getRange(2,2,rows.length,1).setNumberFormat('dd.mm.yyyy hh:mm:ss');
}
function officeAppend_(sheet, rows, width) {
  var first = sheet.getLastRow()+1;
  officeCapacity_(sheet,first+rows.length-1);
  sheet.getRange(first,1,rows.length,width).setValues(officeSafe_(rows));
  sheet.getRange(first,2,rows.length,1).setNumberFormat('dd.mm.yyyy hh:mm:ss');
}
function officeHeader_(grid, expected) {
  if (!grid.length) throw new Error('Нет заголовков');
  Object.keys(expected).forEach(function(index) {if (grid[0][Number(index)] !== expected[index]) throw new Error('Изменён заголовок: ' + expected[index]);});
}
function officeBlank_(value) {return value === '' || value === null || value === undefined;}
function officeNumber_(value) {return typeof value === 'number' && isFinite(value);}
function officeDay_(value, zone) {return value instanceof Date && !isNaN(value.getTime()) ? Utilities.formatDate(value,zone,'yyyy-MM-dd') : null;}
function officeIssue_(code, source, description, action, level) {return {level:level||'Внимание',code:code,source:source,description:description,action:action};}
function officeOrdersHeader_(grid) {officeHeader_(grid,{0:'ID позиции',1:'ID заказа',3:'Канал',8:'Количество',9:'Цена за ед., ₽',10:'Сумма, ₽',11:'Статус',12:'Оплачено, ₽',14:'Обещанная дата'});}

function officeSalesAll_(book, today, dateFn) {
  var issues=[], ids={};
  ['Заказы','Заказы ковры'].forEach(function(name){
    var grid=officeRead_(book,name,20);
    issues=issues.concat(officeSales_(grid,today,dateFn,name));
    grid.slice(1).forEach(function(row,i){
      if(officeBlank_(row[0]))return;
      var key=String(row[0]), source=name+'!A'+(i+2);
      if(Object.prototype.hasOwnProperty.call(ids,key)&&ids[key].sheet!==name)issues.push(officeIssue_('CROSS_SHEET_DUPLICATE_ID',source,'ID позиции уже есть в '+ids[key].source+'.','Сверить источник; не удалять и не переносить запись автоматически.'));
      else ids[key]={sheet:name,source:source};
    });
  });
  return issues;
}

function officeFinanceAll_(book) {
  var shipments=officeRead_(book,'Отгрузка',10), issues=[];
  ['Заказы','Заказы ковры'].forEach(function(name,index){
    issues=issues.concat(officeFinance_(officeRead_(book,name,20),index===0?shipments:[shipments[0]],name));
  });
  return issues;
}

function officeSales_(grid, today, dateFn, sheetName) {
  sheetName = sheetName || 'Заказы';
  officeOrdersHeader_(grid);
  var issues=[], ids={};
  grid.slice(1).forEach(function(r,i){
    if (officeBlank_(r[0])) {if ([1,4,6,8,9].some(function(c){return !officeBlank_(r[c]);})) issues.push(officeIssue_('MISSING_ID',sheetName+'!A'+(i+2),'Заполнена позиция без ID.','Назначить уникальный ID позиции.'));return;}
    var source=sheetName+'!A'+(i+2)+':T'+(i+2);
    if (ids[String(r[0])]) issues.push(officeIssue_('DUPLICATE_ID',source,'Повторяется ID позиции.','Проверить дубликат, не создавать новый заказ автоматически.'));
    ids[String(r[0])]=true;
    if (['Завершён','Отменён'].indexOf(r[11])>=0) return;
    var missing=[];[[1,'ID заказа'],[3,'канал'],[4,'клиент'],[5,'контакт'],[6,'товар'],[11,'статус'],[14,'срок'],[15,'ответственный']].forEach(function(p){if(officeBlank_(r[p[0]]))missing.push(p[1]);});
    if (missing.length) issues.push(officeIssue_('INCOMPLETE_ORDER',source,'Не заполнено: '+missing.join(', ')+'.','Уточнить данные у владельца.'));
    if (!officeNumber_(r[8]) || r[8]<=0 || !officeNumber_(r[9]) || r[9]<0) issues.push(officeIssue_('INVALID_QUANTITY_PRICE',source,'Количество или цена не являются допустимыми числами.','Подтвердить количество и цену.'));
    if (r[3]==='Маркетплейсы') issues.push(officeIssue_('MARKETPLACE_OUT_OF_SCOPE',source,'Заказ маркетплейса попал в журнал продаж.','Учитывать здесь только расход материалов; перенос согласовать с владельцем.'));
    if (!officeBlank_(r[14])) {var due=dateFn(r[14]);if (!due) issues.push(officeIssue_('INVALID_DATE',source,'Срок указан не как дата.','Указать дату готовности.'));else if(due<today)issues.push(officeIssue_('OVERDUE',source,'Обещанная дата прошла, позиция ещё не завершена.','Проверить фактический статус и согласовать новый срок.'));}
    if (['Не проверено','',null,undefined].indexOf(r[16])>=0) issues.push(officeIssue_('STOCK_NOT_CONFIRMED',source,'Наличие или резерв ещё не проверены.','Кладовщику проверить материалы до обещания готовности.'));
  });
  return issues;
}

function officeStock_(grid) {
  officeHeader_(grid,{0:'Название материала',1:'Ед.',5:'Остаток',6:'Ср. Цена'});
  var issues=[];
  grid.slice(1).forEach(function(r,i){if(officeBlank_(r[0])||officeBlank_(r[1]))return;
    var source='Остаток!A'+(i+2)+':G'+(i+2);
    if(!officeNumber_(r[5]))issues.push(officeIssue_('INVALID_STOCK',source,'Остаток не является числом.','Проверить формулу и исходные операции.'));
    else if(r[5]<-0.000001)issues.push(officeIssue_('NEGATIVE_STOCK',source,'Отрицательный расчётный остаток: '+Math.round(r[5]*1000)/1000+' '+r[1]+'.','Сверить физический остаток, начальный баланс, приход и списания.'));
    if(!officeNumber_(r[6])||r[6]<=0)issues.push(officeIssue_('UNKNOWN_MATERIAL_COST',source,'Нет положительной учётной цены материала или кроя.','Подтвердить закупочную цену или калькуляцию.'));
  });return issues;
}

function officeFinance_(orders, shipments, sheetName) {
  sheetName = sheetName || 'Заказы';
  officeOrdersHeader_(orders);officeHeader_(shipments,{2:'Название чехла',4:'Кол-во',6:'Выручка',7:'Себестоимость'});
  var issues=[];
  orders.slice(1).forEach(function(r,i){if(officeBlank_(r[0])||r[11]==='Отменён')return;var source=sheetName+'!I'+(i+2)+':N'+(i+2);
    if(officeBlank_(r[12]))issues.push(officeIssue_('PAYMENT_UNKNOWN',source,'Сумма оплаты неизвестна; долг не подтверждён.','Уточнить фактическую оплату. Пустое поле не заменять нулём.'));
    else if(!officeNumber_(r[12])||r[12]<0)issues.push(officeIssue_('INVALID_PAYMENT',source,'Оплата не является допустимым числом.','Проверить первичный документ.'));
    if(officeNumber_(r[8])&&officeNumber_(r[9])){var expected=r[8]*r[9];if(!officeNumber_(r[10])||Math.abs(expected-r[10])>0.01)issues.push(officeIssue_('TOTAL_MISMATCH',source,'Сумма позиции не совпадает с количеством × ценой.','Проверить формулу суммы.'));if(officeNumber_(r[12])&&r[12]>expected+0.01)issues.push(officeIssue_('OVERPAYMENT',source,'Указанная оплата превышает сумму позиции.','Проверить распределение оплаты по позициям.'));}
  });
  shipments.slice(1).forEach(function(r,i){if(officeBlank_(r[2]))return;var source='Отгрузка!C'+(i+2)+':J'+(i+2);if(!officeNumber_(r[7])||r[7]<=0)issues.push(officeIssue_('SHIPMENT_COST_UNKNOWN',source,'Нет достоверной положительной себестоимости. Прибыль и маржа требуют сверки.','Связать отгрузку с подтверждённой калькуляцией.'));if(!officeNumber_(r[6]))issues.push(officeIssue_('INVALID_REVENUE',source,'Выручка не является числом.','Проверить цену, количество и формулу выручки.'));});
  return issues;
}
