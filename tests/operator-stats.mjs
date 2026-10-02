import assert from 'node:assert/strict';
import {operatorStats} from '../lib/operator-stats.ts';
import {orderDatesForTransition} from '../lib/crm.ts';
const employees=[{id:'a',login:'one',role:'operator',department:'1'},{id:'b',login:'two',role:'operator',department:'2'}];
const order={items:[{name:'Item',quantity:2,price:990}],id:'o',manager:'a',createdAt:'2026-09-30T21:30:00Z',status:'extra',contact:'none',adminReviewedAt:'2026-10-01T01:00:00Z'};
const state={employees,orders:[order],events:[]};
const admin={role:'admin'};
for(const contact of ['none','missed','callback']){order.contact=contact;assert.equal(operatorStats(state,admin,'2026-10-01','2026-10-01')[0].reviewed,1);}
order.status='refused';assert.equal(operatorStats(state,admin,'','')[0].reviewed,0);
order.status='rework';assert.equal(operatorStats(state,admin,'','')[0].newOrders,1);assert.equal(operatorStats(state,admin,'','')[0].reviewed,1);
assert.equal(operatorStats(state,admin,'','2026-09-30')[0].reviewed,0);
assert.equal(operatorStats(state,{role:'department_head',department:'1'},'','').length,1);
assert.equal(operatorStats(state,employees[1],'','')[0].reviewed,0);
delete order.adminReviewedAt;order.status='packing';state.events=[{orderId:'o',text:'Проверка → Упаковка'}];assert.equal(operatorStats(state,admin,'','')[0].reviewed,1);
assert.equal(orderDatesForTransition({...order,status:'check'},'extra','now').adminReviewedAt,'now');
console.log('Operator statistics checks passed');

assert.equal(operatorStats(state,admin,'','')[0].amount,1980);
assert.equal(operatorStats(state,admin,'','')[0].average,1980);
order.status='refused';assert.equal(operatorStats(state,admin,'','')[0].average,0);

assert.equal(operatorStats(state,admin,"","")[0].created,1);
assert.equal(operatorStats(state,admin,"","2026-09-30")[0].created,0);

assert.equal(operatorStats(state,admin,"","")[0].cancelled,1);
assert.equal(operatorStats(state,admin,"","2026-09-30")[0].cancelled,0);
order.status="packing";assert.equal(operatorStats(state,admin,"","")[0].cancelled,0);

assert.deepEqual(operatorStats(state,admin,'','')[0].orderLists.created.map(o=>o.id),['o']);
assert.equal(operatorStats(state,employees[1],'','')[0].orderLists.created.length,0);
assert.equal(operatorStats(state,admin,'','2026-09-30')[0].orderLists.created.length,0);
assert.equal(operatorStats(state,admin,'','')[0].orderLists.cancelled.length,0);
assert.deepEqual(operatorStats(state,admin,'','')[0].orderLists.reviewed.map(o=>o.id),['o']);

order.status='redeemed';
assert.equal(operatorStats(state,admin,'','')[0].redeemed,1);
assert.deepEqual(operatorStats(state,admin,'','')[0].orderLists.redeemed.map(o=>o.id),['o']);
assert.equal(operatorStats(state,admin,'','2026-09-30')[0].redeemed,0);
assert.equal(operatorStats(state,employees[1],'','')[0].redeemed,0);
order.status='returned';assert.equal(operatorStats(state,admin,'','')[0].redeemed,0);
