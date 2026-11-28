// Scenario calculator, not a financial report. Money is integer kopecks.
export function parseRubles(value){
 if(typeof value!=='string'||!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(value.trim()))return null;
 const [whole,fraction='']=value.trim().replace(',','.').split('.');
 return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
export function planUnit(x){
 const fields=['price','cost','platform','logistics','returnsReserve','tax','overhead','targetProfit','advertising'];
 if(!x||fields.some(k=>!Number.isSafeInteger(x[k])||x[k]<0||x[k]>9999999999)||x.price<=0||x.cost<=0)return null;
 if(!['manufacturing','full'].includes(x.costBasis)||x.costBasis==='full'&&x.overhead!==0||x.expensesSeparated!==true)return null;
 const beforeAds=x.price-x.cost-x.platform-x.logistics-x.returnsReserve-x.tax-x.overhead;
 const profit=beforeAds-x.advertising,headroom=beforeAds-x.targetProfit;
 const maxAds=Math.max(0,headroom),breakEvenAds=Math.max(0,beforeAds);
 return {beforeAds,profit,maxAds,breakEvenAds,targetFeasible:headroom>=0,breakEvenFeasible:beforeAds>=0,targetMet:profit>=x.targetProfit,
 maxDrr:maxAds/x.price*100,actualDrr:x.advertising/x.price*100,minimumRoas:headroom>0?x.price/headroom:null};
}
