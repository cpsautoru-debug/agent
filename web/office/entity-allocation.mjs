// Management-only distribution of an entity-level confirmed tax/overhead.
// Never substitutes for the tax register or writes allocations into D1.
const CHANNELS=['ozon','wb','yandex','avito','offline'];
const validMoney=n=>Number.isSafeInteger(n)&&n>=0;
export function allocateEntityTotal({totalKopecks,amounts,eligibleChannels,source}){
 if(!validMoney(totalKopecks)||!amounts||typeof amounts!=='object'||
    !Array.isArray(eligibleChannels)||!eligibleChannels.length||
    typeof source!=='string'||!source.trim())
   throw Error('invalid_allocation_input');
 const eligible=new Set(eligibleChannels);
 if(eligible.size!==eligibleChannels.length||
    [...eligible].some(k=>!CHANNELS.includes(k)))
   throw Error('invalid_taxpayer_channels');
 const unknown=[],weights={};
 for(const channel of CHANNELS){
   if(!eligible.has(channel)){weights[channel]=null;continue;}
   const value=amounts[channel];
   if(value===null||value===undefined){unknown.push(channel);continue;}
   if(!validMoney(value))throw Error('invalid_allocation_income');
   weights[channel]=value;
 }
 if(unknown.length)return {status:'incomplete',source,totalKopecks,
   missingChannels:unknown,allocations:null,allocatedTotalKopecks:null,
   note:'Unconfirmed income may not be replaced with zero.'};
 const sum=eligibleChannels.reduce((a,k)=>a+BigInt(weights[k]),0n);
 if(sum===0n)return {status:'incomplete',source,totalKopecks,
   missingChannels:eligibleChannels,allocations:null,allocatedTotalKopecks:null,
   note:'Zero eligible income cannot allocate a nonzero charge.'};
 // Largest-remainder method: all allocations are integral kopecks, and the
 // allocated total is EXACTLY equal to the amount originally recorded.
 const total=BigInt(totalKopecks);
 const rows=eligibleChannels.map(k=>{
   const numerator=total*BigInt(weights[k]);
   return {channel:k,amountKopecks:Number(numerator/sum),remainder:numerator%sum};
 });
 let remaining=totalKopecks-rows.reduce((a,b)=>a+b.amountKopecks,0);
 const order=[...rows].sort((a,b)=>
   a.remainder===b.remainder?
     CHANNELS.indexOf(a.channel)-CHANNELS.indexOf(b.channel):
     a.remainder>b.remainder?-1:1);
 for(let i=0;i<remaining;i++)order[i].amountKopecks++;
 const allocations=Object.fromEntries(CHANNELS.map(k=>[k,
   eligible.has(k)?rows.find(x=>x.channel===k).amountKopecks:null]));
 return {status:'allocated_management_only',source,totalKopecks,
   missingChannels:[],allocations,allocatedTotalKopecks:
   Object.values(allocations).filter(v=>v!==null).reduce((a,b)=>a+b,0),
   notTaxAccounting:true};
}
