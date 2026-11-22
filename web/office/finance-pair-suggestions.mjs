// Read-only heuristic hints. Scores rank review priority; they are NOT probabilities
// and never establish identity, seller cost, material equivalence, or authorization to save.
import {classifyFinanceProductLabel} from './finance-link-review-groups.mjs';
const norm=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ru')
  .replace(/ё/g,'е').replace(/[_-]/g,' ');
const FEATURES={
  color:[
    ['черный',/(?:черн|black)/u],['белый',/(?:бел|white)/u],
    ['красный',/(?:красн|red)/u],['синий',/(?:син|blue)/u],
    ['серый',/(?:сер|gray|grey)/u],['коричневый',/(?:корич|brown)/u],
    ['бежевый',/(?:беж|beige)/u]
  ],
  texture:[
    ['соты',/(?:сот|honeycomb)/u],['ромб',/(?:ромб|diamond)/u],
    ['полоса',/(?:полос|stripe)/u]
  ],
  material:[
    ['алькантара',/(?:алькантар|alcantara)/u],
    ['экокожа',/(?:экокож|эко кожа|eco leather)/u],
    ['перфорация',/(?:перфорац|perforat)/u]
  ],
  fit:[
    ['седан',/(?:седан|sedan)/u],['хэтчбек',/(?:хэтч|hatch)/u],
    ['универсал',/(?:универсал|wagon)/u]
  ]
};
function features(text){
  const s=norm(text);
  return Object.fromEntries(Object.entries(FEATURES).map(([key,items])=>[
    key,items.filter(([,re])=>re.test(s)).map(([name])=>name)
  ]));
}
export function suggestFinancePairs(wbArticles,ozonOptions,wbCardTitles=new Map()){
  if(!Array.isArray(wbArticles)||!Array.isArray(ozonOptions)||
    !(wbCardTitles instanceof Map)||wbArticles.length>2000||
    ozonOptions.length>2000)throw Error('suggestion_catalog_invalid');
  // Validate both sources before matching; an empty opposite catalog must not
  // hide malformed identities.
  for(const item of ozonOptions){
    if(typeof item?.sku!=='string'||typeof item.name!=='string')
      throw Error('suggestion_ozon_invalid');
  }
  const suggestions=[];
  for(const article of wbArticles){
    if(typeof article!=='string')throw Error('suggestion_article_invalid');
    const title=wbCardTitles.get(article);
    if(title!==undefined&&typeof title!=='string')
      throw Error('suggestion_title_invalid');
    const wbText=(title?title+' ':'')+article;
    const wbGroup=classifyFinanceProductLabel(wbText);
    if(!wbGroup)continue;
    const wf=features(wbText);
    for(const item of ozonOptions){
      if(typeof item?.sku!=='string'||typeof item.name!=='string')
        throw Error('suggestion_ozon_invalid');
      const ozGroup=classifyFinanceProductLabel(item.name);
      if(!ozGroup||ozGroup.key!==wbGroup.key)continue;
      const of=features(item.name);
      const matched=[],unknown=[],conflicts=[];
      for(const key of Object.keys(FEATURES)){
        const a=wf[key],b=of[key];
        if(!a.length||!b.length){unknown.push(key);continue;}
        const overlap=a.filter(v=>b.includes(v));
        if(!overlap.length)conflicts.push(key);
        else matched.push(...overlap.map(v=>key+': '+v));
      }
      // Explicit incompatible variations must not receive a suggestion.
      if(conflicts.length)continue;
      const score=Math.min(90,45+matched.length*12);
      suggestions.push({
        wbVendorCode:article,ozonSku:item.sku,score,
        evidence:[wbGroup.label,...matched],
        missing:unknown,reviewOnly:true,
        physicalIdentityVerified:false,costTransferred:false
      });
    }
  }
  return suggestions.sort((a,b)=>b.score-a.score||
    a.wbVendorCode.localeCompare(b.wbVendorCode,'ru')||
    a.ozonSku.localeCompare(b.ozonSku,'ru')).slice(0,100);
}
