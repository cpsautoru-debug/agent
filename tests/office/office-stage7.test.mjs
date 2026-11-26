import test from 'node:test';
import assert from 'node:assert/strict';

class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.classList={add:()=>{}};this.textContent='';}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=nodes}
 querySelector(){return new Element()}
 addEventListener(type,fn){this.listeners[type]=fn}
 emit(type,detail){this.listeners[type]?.({detail})}
}
test('home renders canonical estimate, confirmed result, and clears prior month',async()=>{
 const ids=Object.fromEntries(['officeHome','ceoBoard','officeHomeSources','officeHomeMetrics','officeHomeChannels','officeHomeReconciliation','businessPnl','ceoMonth'].map(id=>[id,new Element()]));
 const document=new Element();
 document.getElementById=id=>ids[id]||null;
 document.querySelector=()=>new Element();
 document.createElement=tag=>new Element(tag);
 globalThis.document=document;
 globalThis.window=new Element();
 globalThis.location={hash:'#dashboard'};
 try{
  await import('../../web/office/office-home.mjs?stage7-test');
  const metrics=()=>ids.officeHomeMetrics.children;
  const hero=()=>metrics()[0].children.map(x=>x.textContent);
  const pnl={month:'2026-10',verified:false,knownChannelCount:3,knownChannelsTotalKopecks:101525869,sharedExpenseTotalKopecks:5400000,channels:[{id:'ozon',profitKopecks:54836991},{id:'wb',profitKopecks:29149264},{id:'yandex',profitKopecks:17539614}]};
  const management={profitKopecks:75575169,taxKopecks:20550700,taxHint:'По данным владельца'};
  assert.equal(hero()[1],'Н/Д');
  document.emit('office:pnl-rendered',{pnl,management});
  assert.equal(hero()[0],'Расчётная прибыль');
  assert.match(hero()[1],/755\s751,69/);
  assert.match(hero()[2],/сверка не завершена/);
  assert.match(hero()[3],/151%.*предварительно/);
  assert.match(metrics()[2].children[1].textContent,/54\s000/);
  assert.match(metrics()[3].children[1].textContent,/205\s507/);
  assert.equal(ids.officeHomeChannels.children.length,3);
  document.emit('office:pnl-rendered',{pnl:{...pnl,verified:true,finalProfitKopecks:0},management});
  assert.equal(hero()[0],'Чистая прибыль');
  assert.match(hero()[1],/^0,00/);
  ids.ceoMonth.emit('change');
  assert.equal(hero()[1],'Н/Д');
  assert.equal(metrics()[3].children[1].textContent,'Н/Д');
  document.emit('office:pnl-rendered',{pnl:null});
  assert.equal(hero()[1],'Н/Д');
 }finally{delete globalThis.document;delete globalThis.window;delete globalThis.location}
});
