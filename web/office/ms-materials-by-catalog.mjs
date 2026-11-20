// Conservative, read-only inventory classification based on an observed
// MoySklad product-folder path. No keyword matching or fabricated categories.
const MATERIAL_FOLDER=['производство','экокожа и алька'];
const normalize=(s)=>s.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
export function classifyCatalogPath(catalogPath){
  if(typeof catalogPath!=='string'||catalogPath.length>180||
    /[\u0000-\u001f\u007f]/u.test(catalogPath))
    return 'UNVERIFIED';
  const segments=catalogPath.split('/');
  if(segments.length<2||segments.some(s=>!s.trim()))
    return 'UNVERIFIED';
  const a=normalize(segments[0]),b=normalize(segments[1]);
  // Only an exact folder observed in the user's live MoySklad inventory.
  // Other "Производство" folders and ungrouped items remain UNVERIFIED.
  return a===MATERIAL_FOLDER[0]&&b===MATERIAL_FOLDER[1]?
    'MATERIAL_FOLDER_EVIDENCE':'UNVERIFIED';
}
export function selectCatalogPage(items,selection='all'){
  if(!Array.isArray(items)||!['all','materials','unverified'].includes(selection))
    throw Error('invalid_catalog_selection');
  if(items.some(item=>!item||typeof item!=='object'||Array.isArray(item)))
    throw Error('invalid_catalog_items');
  return items.filter(item=>{
    const isMaterial=classifyCatalogPath(item.catalogPath)==='MATERIAL_FOLDER_EVIDENCE';
    return selection==='all'||(selection==='materials'&&isMaterial)||
      (selection==='unverified'&&!isMaterial);
  });
}
export function countCatalogPageEvidence(items){
  const material=selectCatalogPage(items,'materials').length;
  return {material,unverified:items.length-material,total:items.length,
    scope:'CURRENT_API_PAGE_ONLY'};
}
