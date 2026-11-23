// Pure bounded selection for re-checking both known incomplete and uncertain
// historical production records. The order rotates so old uncertain tasks
// are not permanently starved by the first six results.
export function selectProductionRechecks(items,nowMs,maxChecks=6,rotationMs=300000){
  if(!Array.isArray(items)||!Number.isSafeInteger(nowMs)||nowMs<0||
    !Number.isSafeInteger(maxChecks)||maxChecks<1||maxChecks>10||
    !Number.isSafeInteger(rotationMs)||rotationMs<=0)
    throw Error('invalid_production_recheck_selection');
  const incomplete=[],uncertain=[];
  items.forEach((item,index)=>{
    if(item?.status==='incomplete')incomplete.push(index);
    else if(item?.status==='unverified')uncertain.push(index);
  });
  const rotate=uncertain.length?Math.floor(nowMs/rotationMs)%uncertain.length:0;
  return [...incomplete,...uncertain.slice(rotate),...uncertain.slice(0,rotate)]
    .slice(0,maxChecks);
}
