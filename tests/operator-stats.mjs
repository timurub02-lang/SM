import assert from 'node:assert/strict';
import {operatorStats} from '../lib/operator-stats.ts';
const employees=[{id:'a',login:'one',role:'operator',department:'1'},{id:'b',login:'two',role:'operator',department:'2'}];
const order=(id,amount,fields={})=>({id,manager:'a',createdAt:'2026-11-10T21:30:00Z',status:'draft',items:[{name:'Item',quantity:1,price:amount}],...fields});
const state={employees,events:[],orders:[
 order('SM-SK-1',1000),order('CRM-2',2000,{status:'refused',cancelledAt:'2026-11-12T10:00:00Z'}),
 order('CRM-3',3000,{status:'packing',confirmedAt:'2026-11-12T10:00:00Z'}),
 order('CRM-4',4000,{status:'shipping',delivery:'russian_post',confirmedAt:'yes',shippedAt:'yes'}),
 order('CRM-5',5000,{status:'redeemed',delivery:'cdek_pickup',confirmedAt:'yes',shippedAt:'yes'}),
 order('CRM-6',6000,{status:'returned',delivery:'moscow_courier',confirmedAt:'yes',shippedAt:'yes'}),
 order('LV-1',90000,{legacyLv:{orderId:'1'}}),order('test',90000,{testOnly:true}),
 order('old',90000,{createdAt:'2026-11-10T20:59:59Z'}),order('future',90000,{createdAt:'2026-11-11T21:00:00Z'}),
 order('bad-date',90000,{createdAt:'bad'}),order('other',7000,{manager:'b'})
]};
// Duplicate state entry must never double-count a SK order.
state.orders.push({...state.orders[0]});
const [a,b]=operatorStats(state,{role:'admin'},'2026-11-11','2026-11-11');
assert.equal(a.created,6);assert.equal(a.amount,21000);assert.equal(a.average,3500);
assert.equal(a.cancelled,1);assert.equal(a.confirmed,4);assert.equal(a.sent,3);
assert.deepEqual(a.orderLists.sent.map(o=>o.id),['CRM-4','CRM-5','CRM-6']);
assert.equal(b.created,1);assert.equal(b.amount,7000);
assert.equal(operatorStats(state,employees[0],'2026-11-11','2026-11-11').length,1);
assert.equal(operatorStats(state,{role:'department_head',department:'2'},'2026-11-11','2026-11-11')[0].id,'b');
assert.equal(operatorStats(state,{role:'department_head'},'','').length,0);
assert.equal(operatorStats(state,employees[0],'2026-11-20','2026-11-20')[0].average,0);
// A later cancellation does not erase confirmation/shipment, even if restored to rework.
state.orders[3].status='rework';state.orders[3].cancelledAt='yes';
const again=operatorStats(state,employees[0],'2026-11-11','2026-11-11')[0];
assert.equal(again.sent,3);assert.equal(again.confirmed,4);assert.equal(again.cancelled,2);assert.equal(again.amount,21000);
// A CDEK label or administrator review alone is neither confirmation nor shipment.
state.orders=[order('label',10,{status:'extra',adminReviewedAt:'yes',cdekExported:true,cdekTransferredAt:'yes'})];
const label=operatorStats(state,employees[0],'','')[0];assert.equal(label.confirmed,0);assert.equal(label.sent,0);
state.orders[0].cdekAcceptedAt='yes';assert.equal(operatorStats(state,employees[0],'','')[0].sent,1);
console.log('Operator statistics: six columns, all-order amounts, lifecycle overlap, cohort dates, source deduplication and role scope passed');
