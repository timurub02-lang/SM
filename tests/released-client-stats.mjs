import assert from 'node:assert/strict';
import {releasedClientStats} from '../lib/released-client-stats.ts';
const h=(externalId,status,amount)=>({externalId,status,amount,createdAt:'2026-01-01',items:[]});
const c={legacyOrderHistory:[h('1','paid',100),h('2','paid',250.5),h('3','returned',50),h('4','paid',300)]};
const orders=[{id:'LV-1',status:'redeemed',items:[{quantity:2,price:50}]},{id:'new',status:'returned',items:[]},{id:'LV-4',status:'returned',items:[]},{id:'active',status:'sent',items:[{quantity:1,price:999}]}];
assert.deepEqual(releasedClientStats(c,orders),{purchases:2,purchaseAmount:350.5,returns:3});
assert.deepEqual(releasedClientStats({},[]),{purchases:0,purchaseAmount:0,returns:0});
console.log('released stats OK');
