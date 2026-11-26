import test from 'node:test';
import assert from 'node:assert/strict';
import {reservationPlan,cancellationPlan,returnPlan,dealerBalance} from '../functions/api/orders/ms-sales-lifecycle.mjs';
test('reserve only verified free stock',()=>{
 const lines=[{itemId:'a',ordered:5,reserved:2,free:1}];
 assert.deepEqual(reservationPlan(lines,true,true),[{itemId:'a',reserve:1,missing:2}]);
 assert.throws(()=>reservationPlan(lines,true,false));
 assert.throws(()=>reservationPlan([...lines,...lines],true,true));
});
test('cancellation releases only unshipped reservation',()=>{
 const input={cancelled:true,shipmentState:'not_shipped',reservations:[{itemId:'a',quantity:2}]};
 assert.deepEqual(cancellationPlan(input),[{itemId:'a',release:2}]);
 assert.throws(()=>cancellationPlan({...input,shipmentState:'unknown'}));
});
test('return requires physical receipt and remaining shipped quantity',()=>{
 const input={receiptVerified:true,duplicate:'not_found',shipped:[{itemId:'a',quantity:5,previouslyReturned:3}],returned:[{itemId:'a',quantity:2}]};
 assert.deepEqual(returnPlan(input),input.returned);
 for(const patch of [{receiptVerified:false},{duplicate:'already_exists'},{returned:[{itemId:'a',quantity:3}]}])assert.throws(()=>returnPlan({...input,...patch}));
});
test('dealer debt uses confirmed events once and never invents opening debt',()=>{
 const events=[{id:'s',kind:'shipment',amountMinor:100000,verified:true},{id:'p',kind:'payment',amountMinor:40000,verified:true},{id:'r',kind:'return',amountMinor:20000,verified:true}];
 const input={openingMinor:10000,mode:'sale',complete:true,events};
 assert.deepEqual(dealerBalance(input),{verified:true,balanceMinor:50000});
 for(const patch of [{openingMinor:null},{mode:'commission'},{complete:false},{events:[...events,events[0]]}])assert.deepEqual(dealerBalance({...input,...patch}),{verified:false,balanceMinor:null});
});
