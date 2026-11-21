// Read-only draft grouping of *real* WB seller articles.
// Never infer a COGS price or write a product mapping from keyword matches.
// Names in financial exports may omit model details (year, trim, seat layout),
// so even a high-confidence family is NOT a verified product identity.
export const FAMILY_DEFINITIONS=Object.freeze([
  {id:'door_inserts',label:'Дверные карты / вставки'},
  {id:'vesta_cross',label:'Lada Vesta Cross'},
  {id:'vesta_sw',label:'Lada Vesta SW (уточнить Cross)'},
  {id:'vesta',label:'Lada Vesta (прочие)'},
  {id:'priora',label:'Lada Priora'},
  {id:'iskra',label:'Lada Iskra'},
  {id:'samara',label:'Lada Samara'},
  {id:'granta',label:'Lada Granta'},
  {id:'niva_travel',label:'Lada Niva Travel'},
  {id:'creta',label:'Hyundai Creta'},
  {id:'rio',label:'Kia Rio'},
  {id:'accessories',label:'Аксессуары — не переносить себестоимость чехлов'},
  {id:'unrecognized',label:'Не определены — требуется идентификация'}
]);
const valid=x=>typeof x==='string'&&x.length>=1&&x.length<=200&&
  !/[\u0000-\u001f\u007f]/u.test(x);
const tidy=x=>x.normalize('NFKC').toLocaleLowerCase('ru')
  .replaceAll('ё','е').trim().replace(/[\s._/\\-]+/g,' ');
const has=(text,word)=>new RegExp('(?:^|[^\\p{L}])'+word+'(?:$|[^\\p{L}])','u').test(text);
function family(value){
  const s=tidy(value);
  if(has(s,'(?:eva|эва)')||
    /коврик|подлокот|брелок|ароматизатор|накидк|универсал|порог|накладк/u.test(s))
    return 'accessories';
  // WB seller codes may use "карты_лада_веста" without the word
  // "дверные". Treat these as door inserts BEFORE any car-model token.
  // Otherwise a cover-family batch can assign the 4200 ₽ seat-cover cost
  // to door cards solely because "веста" appears in their name.
  if(has(s,'(?:карта|карты|карт)')||
    (/дверн|вставк|двере|двери|door\s*card|door\s*insert/u.test(s)&&
      /карт|вставк|обшивк|двер/u.test(s)))
    return 'door_inserts';
  const hasVesta=has(s,'(?:vesta|веста|vestacross|вестакросс|vestasw)');
  const cross=has(s,'(?:cross|кросс)')||/vestacross|вестакросс/u.test(s);
  const sw=has(s,'(?:sw|св)')||/vestasw/u.test(s);
  const hits=[
    hasVesta?'vesta':null,
    has(s,'(?:priora|приора)')?'priora':null,
    has(s,'(?:iskra|искра)')?'iskra':null,
    has(s,'(?:samara|самара)')?'samara':null,
    has(s,'(?:granta|гранта)')?'granta':null,
    /(?:niva|нива)/u.test(s)&&has(s,'(?:travel|тревел)')?'niva_travel':null,
    has(s,'(?:creta|крета)')?'creta':null,
    has(s,'(?:rio|рио)')?'rio':null
  ].filter(Boolean);
  if(hits.length!==1)return 'unrecognized';
  if(hits[0]==='vesta')return cross?'vesta_cross':sw?'vesta_sw':'vesta';
  return hits[0];
}
export function buildWbModelDraft(articles){
  if(!Array.isArray(articles)||articles.length>1200||
    articles.some(x=>!valid(x)))throw Error('wb_model_source_unverified');
  const unique=new Set(articles);
  if(unique.size!==articles.length)throw Error('wb_model_source_duplicate');
  const groups=new Map(FAMILY_DEFINITIONS.map(({id})=>[id,[]]));
  for(const article of articles){
    groups.get(family(article)).push(article);
  }
  const summary=FAMILY_DEFINITIONS.map(({id,label})=>({
    id,label,articleCount:groups.get(id).length,
    articles:groups.get(id).sort((a,b)=>a.localeCompare(b,'ru')),
    confidence:'draft_not_product_identity'
  })).filter(x=>x.articleCount>0);
  return {
    code:'wb_model_draft',source:'WB_SELLER_ARTICLES_ONLY',
    readOnly:true,changedRecords:0,
    totalArticles:articles.length,groupCount:summary.length,
    confirmedMappingCount:0,assignedCostCount:0,
    groups:summary,
    warning:'Product category, seat configuration, color, trim and manufacturing cost remain unverified'
  };
}
