// Browser-only reference CSV for catalog fixes. This is not an import into MoySklad.
const safe=s=>typeof s==='string'?s.slice(0,200).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' '):'';
const csvCell=value=>{
  let v=safe(String(value??''));
  // Spreadsheet formula-injection protection for names entered in an external ERP.
  if(/^[\s]*[=+\-@]/u.test(v))v="'"+v;
  return '"'+v.replaceAll('"','""')+'"';
};
export function missingCatalogRows(items){
  if(!Array.isArray(items)||items.length>40||
    items.some(item=>!item||typeof item!=='object'||Array.isArray(item)))
    throw Error('invalid_catalog_quality_scope');
  return items.filter(item=>
    typeof item.catalogPath!=='string'||!item.catalogPath.trim()||
    typeof item.uom!=='string'||!item.uom.trim()
  );
}
export function buildCatalogFixCsv(items,warehouse){
  if(typeof warehouse!=='string'||!warehouse.trim()||warehouse.length>120)
    throw Error('invalid_catalog_quality_warehouse');
  const missing=missingCatalogRows(items);
  const header=[
    'Склад','Номенклатура','Артикул','Учётный остаток',
    'Единица измерения','Группа каталога','Проблема','Примечание'
  ];
  const rows=[header];
  for(const item of missing){
    const missingGroup=typeof item.catalogPath!=='string'||!item.catalogPath.trim();
    const missingUnit=typeof item.uom!=='string'||!item.uom.trim();
    const issue=[missingGroup?'Нет группы':'',missingUnit?'Нет единицы':''].filter(Boolean).join(', ');
    const value=typeof item.stock==='number'&&Number.isFinite(item.stock)?
      String(item.stock):'Неизвестно';
    rows.push([
      warehouse,item.name||'Не указано',item.code||'',value,
      missingUnit?'Не указана':item.uom,
      missingGroup?'Группа не указана':item.catalogPath,
      issue,
      'Только проверка номенклатуры; не импортировать автоматически'
    ]);
  }
  return {rows:missing.length,
    csv:'\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n'};
}
