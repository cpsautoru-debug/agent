// WB card metadata is *review assistance*, never proof of physical
// correspondence, seller cost, or inventory. Exact vendorCode only.
const safeText=(v,max)=>typeof v==='string'&&v.trim().length>0&&
  v.trim()===v&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v);
export function inspectWbCardsPage(payload,codes){
  if(!payload||!Array.isArray(payload.cards)||payload.cards.length>100||
    !payload.cursor||!Number.isSafeInteger(payload.cursor.total)||
    payload.cursor.total<0||payload.cursor.total>100||
    !Array.isArray(codes)||codes.some(x=>!safeText(x,200)))
    throw Error('wb_content_page_invalid');
  const wanted=new Set(codes);
  const entries=[];
  for(const card of payload.cards){
    if(!safeText(card?.vendorCode,200)||!wanted.has(card.vendorCode))
      continue;
    // A WB card may have no title or a generic title; it must not be
    // fabricated from subjectName or guessed from vendorCode.
    if(!safeText(card.title,600))continue;
    entries.push({
      vendorCode:card.vendorCode,
      title:card.title,
      subjectName:safeText(card.subjectName,160)?
        card.subjectName:null,
      nmID:Number.isSafeInteger(card.nmID)&&card.nmID>0?
        card.nmID:null,
      physicalIdentityVerified:false,costTransferred:false
    });
  }
  return{
    entries,
    total:payload.cursor.total,
    cursor:payload.cursor
  };
}
export function finalizeWbCardLookup({codes,found,complete,pages}){
  if(!Array.isArray(codes)||!Array.isArray(found)||
    typeof complete!=='boolean'||!Number.isSafeInteger(pages)||
    pages<0||pages>5)throw Error('wb_card_coverage_invalid');
  const wanted=new Set(codes);
  if(wanted.size!==codes.length)throw Error('wb_card_coverage_invalid');
  const seen=new Set();
  for(const item of found){
    if(!wanted.has(item.vendorCode)||seen.has(item.vendorCode))
      throw Error('wb_card_coverage_invalid');
    seen.add(item.vendorCode);
  }
  const unmatched=codes.filter(x=>!seen.has(x));
  return{
    items:found,matchedCount:found.length,totalFinanceCodes:codes.length,
    unmatched,fullyScanned:complete,pagesRead:pages,
    unmatchedAreAbsentFromCurrentCards:complete,
    readOnly:true,changedRecords:0,
    physicalIdentityVerified:false
  };
}
