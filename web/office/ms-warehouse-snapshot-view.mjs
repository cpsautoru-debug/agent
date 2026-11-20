import {classifyCatalogPath} from './ms-materials-by-catalog.mjs';
// Documented folder evidence observed in the owner's live MoySklad screenshots.
// EVA is a merchandise/catalog group, NOT evidence of in-house manufacturing.
const fold=s=>s.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
export function classifyWarehouseItem(item){
  if(classifyCatalogPath(item?.catalogPath)==='MATERIAL_FOLDER_EVIDENCE')
    return 'materials';
  const path=item?.catalogPath;
  if(typeof path==='string'&&path.length<=180&&
    !/[\u0000-\u001f\u007f]/u.test(path)){
    const parts=path.split('/');
    if(parts.length>=2&&parts.every(p=>p.trim())&&
      fold(parts[0])==='коврики ева пресс форма'&&fold(parts[1])==='иномарки')
      return 'eva';
  }
  return 'unverified';
}
export function filterSnapshotItems(items,selection='all'){
  if(!Array.isArray(items)||!['all','materials','eva','unverified'].includes(selection))
    throw Error('invalid_snapshot_selection');
  if(items.some(item=>!item||typeof item!=='object'||Array.isArray(item)))
    throw Error('invalid_snapshot_items');
  return selection==='all'?items:
    items.filter(item=>classifyWarehouseItem(item)===selection);
}
export function snapshotCounts(items){
  if(!Array.isArray(items))throw Error('invalid_snapshot_items');
  const counts={materials:0,eva:0,unverified:0};
  for(const item of items)counts[classifyWarehouseItem(item)]++;
  return {...counts,total:items.length};
}
