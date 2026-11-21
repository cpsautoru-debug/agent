import {buildWbModelDraft,FAMILY_DEFINITIONS} from './wb-model-group-core.mjs';

// A batch is strictly opt-in, same-tech-card reviewed, and never originates
// from keyword classification alone. Up to 25 unique WB articles per batch.
// No default cost or date: those must be supplied by the owner.
const ALLOWED=new Set(FAMILY_DEFINITIONS.map(x=>x.id)
  .filter(x=>x!=='accessories'&&x!=='unrecognized'));
const validCode=x=>typeof x==='string'&&x.length>0&&x.length<=200&&
  !/[\u0000-\u001f\u007f]/u.test(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function validateModelCostBatch(data){
  if(!data||!ALLOWED.has(data.familyId)||
    !Array.isArray(data.vendorCodes)||data.vendorCodes.length<1||
    data.vendorCodes.length>25||
    data.vendorCodes.some(x=>!validCode(x))||
    new Set(data.vendorCodes).size!==data.vendorCodes.length||
    data.vendorCodes.join('').length>2300||
    !Number.isSafeInteger(data.costKopecks)||data.costKopecks<1||
    data.costKopecks>100000000||
    !day(data.validFrom)||
    !['preliminary','confirmed'].includes(data.status)||
    typeof data.source!=='string'||data.source.length<3||
    data.source.length>200||/[\u0000-\u001f\u007f]/u.test(data.source)||
    data.sameTechCardConfirmed!==true||
    data.includesMaterialsSeamstressCutterOnly!==true||
    (data.status==='confirmed'&&data.explicitlyConfirmed!==true))
    throw Error('wb_model_cost_review_invalid');
  // The server derives a family from each real seller article independently;
  // a mixed or unrelated group cannot be written by a tampered client.
  const groups=buildWbModelDraft(data.vendorCodes).groups;
  if(groups.length!==1||groups[0].id!==data.familyId||
    groups[0].articleCount!==data.vendorCodes.length)
    throw Error('wb_model_cost_family_mismatch');
  const normalized=[...data.vendorCodes].sort((a,b)=>a.localeCompare(b,'ru'));
  return {
    familyId:data.familyId,vendorCodes:normalized,
    validFrom:data.validFrom,costKopecks:data.costKopecks,
    status:data.status,
    source:data.source,
    sameTechCardConfirmed:true,
    includesMaterialsSeamstressCutterOnly:true,
    explicitlyConfirmed:data.status==='confirmed'
  };
}
