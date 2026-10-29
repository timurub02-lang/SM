import assert from 'node:assert/strict';
import {premiumOrders} from '../lib/premium-orders.ts';
import {visibleState} from '../lib/permissions.ts';
const admin={id:'admin',role:'admin'},a={id:'a',role:'operator',department:'one'},b={id:'b',role:'operator',department:'two'},head={id:'head',role:'department_head',department:'one'},staff=[admin,a,b,head];
const receipt={slot:1,registry:'42',paymentDate:'2026-10-28',amountCents:950001,collectedCents:1000000};
const order={id:'1',clientId:'c',status:'redeemed',manager:'a',delivery:'cdek_pickup',cdekRemittances:[receipt]};
const orders=[order,{...order,id:'2',manager:'b'},{...order,id:'pending',cdekRemittances:[]},{...order,id:'conflict',cdekRemittances:[receipt,{...receipt,registry:'43'}]},{...order,id:'zero',cdekRemittances:[{...receipt,amountCents:0}]},{...order,id:'test',testOnly:true},{...order,id:'returned',status:'returned'},{...order,id:'post',delivery:'russian_post',cdekRemittances:[],paymentReceivedAt:'2026-10-28T22:00:00Z',paymentReceipt:{amount:11000}},{...order,id:'courier',delivery:'moscow_courier',cdekRemittances:[],paymentReceivedAt:'2026-10-28T10:00:00Z',paymentReceipt:{amount:10000}},{...order,id:'no-receipt',delivery:'moscow_courier',cdekRemittances:[],paymentReceivedAt:'2026-10-28T10:00:00Z'}];
assert.deepEqual(premiumOrders(orders,admin,staff).map(r=>r.order.id),['post','1','2','courier']);
assert.deepEqual(premiumOrders(orders,a,staff).map(r=>r.order.id),['post','1','courier']);
assert.deepEqual(premiumOrders(orders,head,staff).map(r=>r.order.id),['post','1','courier']);
assert.equal(premiumOrders(orders,{...head,department:undefined},staff).length,0);
assert.equal(premiumOrders(orders,{id:'log',role:'logistic'},staff).length,0);
assert.equal(premiumOrders([order],admin,staff)[0].amount,9500.01);
assert.equal(premiumOrders(orders,admin,staff)[0].date,'2026-10-29');
// Server-filtered state retains receipt metadata and cannot reveal another department's orders.
for(const actor of [a,head]){
 const state=visibleState({orders,employees:staff,clients:[],events:[],incoming:[],settings:{}},actor);
 assert(!state.orders.some(o=>o.id==='2'));
 assert.equal(premiumOrders(state.orders,actor,state.employees).length,3);
}
console.log('Premium orders: visibility, receipts, conflicts, kopecks and Moscow dates passed');
const headTerms={...head,leaderPremium:{model:'udl_guarantee',fixedPerPeriod:0,monthlyGuarantee:100000,firstPeriod:50000,links:[{operatorId:'a',login:'a',rate:7}]}};
const scoped={orders:[order],employees:[a,headTerms],clients:[],events:[],incoming:[],settings:{}};
assert.equal(visibleState(scoped,a).employees.find(e=>e.id==='head')?.leaderPremium,undefined);
assert.equal(visibleState(scoped,headTerms).employees.find(e=>e.id==='head').leaderPremium.monthlyGuarantee,100000);
