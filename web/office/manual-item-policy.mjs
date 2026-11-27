// Owner-approved exception, not a stock/SKU mapping or a production instruction.
export function manualItemReason(source,sku){
 return source==='wb'&&typeof sku==='string'&&sku.trim().toLocaleLowerCase('ru-RU')==='пламя1'
  ?'wb_plamya1_manual':null;
}
