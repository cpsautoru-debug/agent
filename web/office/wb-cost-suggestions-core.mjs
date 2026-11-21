// Read-only cross-channel suggestions: NEVER an accounting source of truth.
// Exact WB vendor_code = Ozon seller_article match only; no fuzzy matching,
// case-folding, numeric SKU fallback, inferred dates or automatic DB writes.
const validCode=x=>typeof x==='string'&&x.length>0&&x.length<=200&&
  !/[\u0000-\u001f\u007f]/u.test(x);
const validText=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&
  !/[\u0000-\u001f\u007f]/u.test(x);
export function findOzonCostSuggestions(wbArticles,ozonCosts){
  if(!Array.isArray(wbArticles)||wbArticles.length>1200||
    !Array.isArray(ozonCosts)||ozonCosts.length>5000||
    wbArticles.some(x=>!validCode(x?.vendorCode)))
    throw Error('wb_ozon_suggestions_unverified');
  const wb=new Set(wbArticles.map(x=>x.vendorCode));
  if(wb.size!==wbArticles.length)throw Error('wb_suggestion_duplicates');
  const matching=new Map();
  let rejected=0;
  for(const row of ozonCosts){
    if(!validCode(row?.seller_article)||!wb.has(row.seller_article))continue;
    const ok=validText(row.sku,150)&&validText(row.model,100)&&
      validText(row.source,250)&&row.status==='confirmed'&&
      Number.isSafeInteger(row.cost_kopecks)&&
      row.cost_kopecks>0&&row.cost_kopecks<=100000000;
    if(!ok){rejected++;continue;}
    const options=matching.get(row.seller_article)||[];
    options.push(row);matching.set(row.seller_article,options);
  }
  const matches=[],ambiguous=[];
  for(const [vendorCode,options] of matching){
    // Two Ozon SKUs for one WB vendor code are not automatically equivalent.
    if(options.length!==1){ambiguous.push(vendorCode);continue;}
    const row=options[0];
    matches.push({
      vendorCode,ozonSku:row.sku,model:row.model,
      costKopecks:row.cost_kopecks,source:row.source,
      status:'candidate_needs_owner_confirmation'
    });
  }
  matches.sort((a,b)=>a.vendorCode.localeCompare(b.vendorCode,'ru'));
  ambiguous.sort((a,b)=>a.localeCompare(b,'ru'));
  return {
    source:'OZON_CONFIRMED_COST_ENTRIES_EXACT_ARTICLE_ONLY',
    readOnly:true,changedRecords:0,
    suggestions:matches,ambiguousVendorCodes:ambiguous,
    rejectedMatches:rejected,
    notMatchedCount:wb.size-matches.length-ambiguous.length,
    sourceStats:{
      ozonCostRows:ozonCosts.length,
      confirmedRows:ozonCosts.filter(x=>x?.status==='confirmed').length,
      preliminaryRows:ozonCosts.filter(x=>x?.status==='preliminary').length,
      confirmedWithArticle:ozonCosts.filter(x=>
        x?.status==='confirmed'&&validCode(x?.seller_article)).length,
      matchingArticleRows:ozonCosts.filter(x=>
        validCode(x?.seller_article)&&wb.has(x.seller_article)).length
    },
    reason:'Different channel; cost composition and effective date MUST be confirmed'
  };
}
