// Read-only, conservative grouping to shorten manual WB↔Ozon review.
// Shared model+product kind is NOT physical product identity or COGS equality.
// Never use a derived group as an argument for a server-side write.
const models=[
  {id:'vesta-cross',label:'Lada Vesta Cross',
    test:s=>/(?:веста|vesta)/u.test(s)&&/(?:кросс|cross)/u.test(s)},
  {id:'vesta',label:'Lada Vesta',
    test:s=>/(?:веста|vesta)/u.test(s)},
  {id:'priora',label:'Lada Priora',
    test:s=>/(?:приор|priora)/u.test(s)},
  {id:'iskra',label:'Lada Iskra',
    test:s=>/(?:искра|iskra)/u.test(s)},
  {id:'granta',label:'Lada Granta',
    test:s=>/(?:грант|granta)/u.test(s)},
  {id:'samara',label:'Lada Samara',
    test:s=>/(?:самар|samara)/u.test(s)},
  {id:'niva-travel',label:'Niva Travel',
    test:s=>/(?:нива|niva)/u.test(s)&&/(?:тревел|travel)/u.test(s)},
  {id:'niva',label:'Niva',
    test:s=>/(?:нива|niva)/u.test(s)},
  {id:'creta',label:'Hyundai Creta',
    test:s=>/(?:крета|creta)/u.test(s)}
];
const normal=s=>typeof s==='string'?s.normalize('NFKC')
  .toLocaleLowerCase('ru').replace(/ё/g,'е')
  .replace(/[_-]/g,' '):'';
const category=s=>{
  if(/(?:коврик|ковер|ковры|багажник|радиатор|брелок|ароматизатор|подлокотник|порог|тормоз|eva)/u.test(s))
    return null;
  if(/(?:дверн|вставк|карт[аыу]|карт\b)/u.test(s))
    return 'door';
  if(/(?:накидк|чехл|авточехл)/u.test(s))
    return 'seat';
  // A generic WB vendor code ("веста №2") has no explicit product kind.
  // Keep it OUT of candidate groups rather than assume it is a seat cover.
  return null;
};
export function classifyFinanceProductLabel(label){
  const name=normal(label);
  if(!name||name.length>600||/[\u0000-\u001f\u007f]/u.test(name))
    return null;
  const kind=category(name);
  const model=models.find(x=>x.test(name));
  if(!model||!kind)return null;
  return {key:model.id+'|'+kind,
    label:model.label+' · '+(kind==='seat'?'авточехлы':'дверные вставки'),
    model:model.id,kind};
}
export function makeFinanceReviewGroups(wbArticles,ozonOptions){
  if(!Array.isArray(wbArticles)||wbArticles.length>2000||
    !Array.isArray(ozonOptions)||ozonOptions.length>2000)
    throw Error('review_catalog_invalid');
  const groups=new Map();
  let ambiguousWb=0,ambiguousOzon=0;
  for(const article of wbArticles){
    if(typeof article!=='string')throw Error('review_wb_invalid');
    const found=classifyFinanceProductLabel(article);
    if(!found){ambiguousWb++;continue;}
    const group=groups.get(found.key)||{
      ...found,wbArticles:[],ozonSkus:[]
    };
    group.wbArticles.push(article);groups.set(found.key,group);
  }
  for(const item of ozonOptions){
    if(typeof item?.sku!=='string'||typeof item.name!=='string')
      throw Error('review_ozon_invalid');
    const found=classifyFinanceProductLabel(item.name);
    if(!found){ambiguousOzon++;continue;}
    const group=groups.get(found.key)||{
      ...found,wbArticles:[],ozonSkus:[]
    };
    group.ozonSkus.push(item.sku);groups.set(found.key,group);
  }
  const available=[...groups.values()]
    .filter(x=>x.wbArticles.length>0&&x.ozonSkus.length>0)
    .sort((a,b)=>a.label.localeCompare(b.label,'ru'))
    .map(x=>({
      key:x.key,label:x.label,
      wbArticles:x.wbArticles,ozonSkus:x.ozonSkus,
      wbCount:x.wbArticles.length,ozonCount:x.ozonSkus.length,
      physicalIdentityVerified:false,costTransferred:false
    }));
  return {
    groups:available,ambiguousWb,ambiguousOzon,
    status:'model_and_kind_review_only',
    physicalIdentityVerified:false,changedRecords:0,
    linkedCount:0
  };
}
