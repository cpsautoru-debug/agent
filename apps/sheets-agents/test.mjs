import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const api=vm.createContext({});
vm.runInContext(readFileSync(new URL('./Code.gs',import.meta.url),'utf8'),api);
const h=['ID позиции','ID заказа','Дата заявки','Канал','Клиент','Контакт','Товар / артикул','Автомобиль / вариант','Количество','Цена за ед., ₽','Сумма, ₽','Статус','Оплачено, ₽','Долг, ₽','Обещанная дата','Ответственный','Резерв / наличие','Источник / ссылка','Следующий шаг','Контроль'];
const sh=['Дата','Покупатель','Название чехла','Тип','Кол-во','Цена продажи','Выручка','Себестоимость','Прибыль','Маржа %'];
const stockH=['Название материала','Ед.','Приход всего','Ушло на крой','Ушло на пошив','Остаток','Ср. Цена'];
const row=()=>['P1','O1','','Дилеры — Пламя','Дилер','контакт','Товар','вариант',1,5500,5500,'Подтверждён',0,5500,'2026-10-20','Менеджер продаж','Зарезервировано'];
const codes=issues=>Array.from(issues,x=>x.code);
const day=v=>/^\d{4}-\d\d-\d\d$/.test(v)?v:null;

test('controllers include carpet orders and retain their source sheet',()=>{
 const carpet=row();carpet[0]='CARPET-1';carpet[5]='';carpet[12]='';
 const grids={'Заказы':[h],'Заказы ковры':[h,carpet],'Отгрузка':[sh]};
 const book={getSheetByName:name=>({getLastRow:()=>grids[name].length,getMaxColumns:()=>26,getRange:()=>({getValues:()=>grids[name]})})};
 const sales=api.officeSalesAll_(book,'2026-10-17',day),finance=api.officeFinanceAll_(book);
 assert.ok(sales.some(x=>x.code==='INCOMPLETE_ORDER'&&x.source.startsWith('Заказы ковры!')));
 assert.ok(finance.some(x=>x.code==='PAYMENT_UNKNOWN'&&x.source.startsWith('Заказы ковры!')));
});

test('order position identifiers must be unique across covers and carpets',()=>{
 const grids={'Заказы':[h,row()],'Заказы ковры':[h,row()]};
 const book={getSheetByName:name=>({getLastRow:()=>grids[name].length,getMaxColumns:()=>26,getRange:()=>({getValues:()=>grids[name]})})};
 assert.ok(codes(api.officeSalesAll_(book,'2026-10-17',day)).includes('CROSS_SHEET_DUPLICATE_ID'));
});

test('finance reports shipment cost once while checking both order sheets',()=>{
 const grids={'Заказы':[h],'Заказы ковры':[h],'Отгрузка':[sh,['','','Тестовая отгрузка','Разовый',1,100,100,0]]};
 const book={getSheetByName:name=>({getLastRow:()=>grids[name].length,getMaxColumns:()=>26,getRange:()=>({getValues:()=>grids[name]})})};
 assert.equal(codes(api.officeFinanceAll_(book)).filter(code=>code==='SHIPMENT_COST_UNKNOWN').length,1);
 delete grids['Заказы ковры'];
 assert.throws(()=>api.officeFinanceAll_(book));
});
test('blank payment is unknown; explicit zero is known',()=>{const a=row();a[12]='';assert.ok(codes(api.officeFinance_([h,a],[sh])).includes('PAYMENT_UNKNOWN'));a[12]=0;assert.equal(api.officeFinance_([h,a],[sh]).length,0);});
test('two order positions do not duplicate their order ID',()=>{const a=row(),b=row();b[0]='P2';assert.equal(api.officeSales_([h,a,b],'2026-10-17',day).length,0);assert.equal(api.officeFinance_([h,a,b],[sh]).length,0);});
test('duplicate position, missing fields and unknown availability detected',()=>{const a=row(),b=row();a[5]='';b[16]='Не проверено';const c=codes(api.officeSales_([h,a,b],'2026-10-17',day));for(const expected of ['DUPLICATE_ID','INCOMPLETE_ORDER','STOCK_NOT_CONFIRMED'])assert.ok(c.includes(expected));});
test('overdue only for unfinished positions, invalid dates do not pass',()=>{const a=row();a[14]='2026-10-16';assert.ok(codes(api.officeSales_([h,a],'2026-10-17',day)).includes('OVERDUE'));a[11]='Завершён';assert.equal(api.officeSales_([h,a],'2026-10-17',day).length,0);a[11]='Подтверждён';a[14]='срочно';assert.ok(codes(api.officeSales_([h,a],'2026-10-17',day)).includes('INVALID_DATE'));});
test('cancelled payments are skipped, marketplaces stay outside sales scope',()=>{const a=row();a[11]='Отменён';a[12]='';assert.equal(api.officeFinance_([h,a],[sh]).length,0);a[11]='Новый';a[3]='Маркетплейсы';assert.ok(codes(api.officeSales_([h,a],'2026-10-17',day)).includes('MARKETPLACE_OUT_OF_SCOPE'));});
test('warehouse skips section labels but reports negative stock and cost gaps',()=>{const a=[stockH,['Крой'],['Материал','м',0,0,0,-24,0],['Другой','шт',0,0,0,'#N/A',210]];const c=codes(api.officeStock_(a));assert.deepEqual(c,['NEGATIVE_STOCK','UNKNOWN_MATERIAL_COST','INVALID_STOCK']);});
test('cost errors, total errors and overpayments do not become valid profit',()=>{const a=row();a[10]=11000;a[12]=6000;const shipment=['','','Товар','Разовый',1,5500,5500,'#N/A'];const c=codes(api.officeFinance_([h,a],[sh,shipment]));assert.deepEqual(c,['TOTAL_MISMATCH','OVERPAYMENT','SHIPMENT_COST_UNKNOWN']);});
test('header drift fails closed',()=>{const wrong=[...h];wrong[9]='Новая цена';assert.throws(()=>api.officeSales_([wrong,row()],'2026-10-17',day),/Изменён заголовок/);});
test('report strings cannot inject formulas',()=>{const v=api.officeSafe_([['=IMPORTDATA("x")','+1','@foo','-2',5,'текст']])[0];assert.deepEqual(Array.from(v),["'=IMPORTDATA(\"x\")","'+1","'@foo","'-2",5,'текст']);});
test('source bounds stop rather than silently truncate',()=>{assert.throws(()=>api.officeRead_({getSheetByName:()=>({getLastRow:()=>5001})},'Заказы',20),/не усечена/);});
