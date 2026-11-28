// Scenario calculator, not a financial report. All money inputs are kopecks.
export function planUnit(x){
 const fields=['price','cost','platform','logistics','returnsReserve','tax','overhead','targetProfit','advertising'];
 if(!x||fields.some(k=>!Number.isSafeInteger(x[k])||x[k]<0)||x.price<=0)return null;
 const beforeAds=x.price-x.cost-x.platform-x.logistics-x.returnsReserve-x.tax-x.overhead;
 const profit=beforeAds-x.advertising,headroom=beforeAds-x.targetProfit;
 if(![beforeAds,profit,headroom].every(Number.isSafeInteger))return null;
 const maxAds=Math.max(0,headroom),breakEvenAds=Math.max(0,beforeAds);
 return {beforeAds,profit,maxAds,breakEvenAds,targetFeasible:headroom>=0,breakEvenFeasible:beforeAds>=0,targetMet:profit>=x.targetProfit,
 maxDrr:maxAds/x.price*100,actualDrr:x.advertising/x.price*100,minimumRoas:headroom>0?x.price/headroom:null};
}
