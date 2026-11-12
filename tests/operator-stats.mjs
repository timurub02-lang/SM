import assert from 'node:assert/strict';
import {operatorStats,sortOperatorStats,operatorStatsSummary} from '../lib/operator-stats.ts';
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
const allSummary=operatorStatsSummary(state,{role:'department_head',department:'1'},'2026-11-11','2026-11-11');
assert.equal(allSummary.length,2);
assert.ok(allSummary.every(row=>!('orderLists' in row)&&!('orders' in row)));
assert.ok(!JSON.stringify(allSummary).includes('CRM-'));
assert.throws(()=>operatorStatsSummary(state,employees[0],'',''));
const [a,b]=operatorStats(state,{role:'admin'},'2026-11-11','2026-11-11');
assert.equal(a.created,6);assert.equal(a.amount,21000);assert.equal(a.average,3500);
assert.equal(a.inWork,1);assert.deepEqual(a.orderLists.inWork.map(o=>o.id),['SM-SK-1']);
assert.equal(a.awaitingShipment,1);assert.deepEqual(a.orderLists.awaitingShipment.map(o=>[o.id,o.status]),[['CRM-3','packing']]);
assert.equal(allSummary[0].awaitingShipment,1);
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
state.orders[2].cancelledAt='yes';state.orders[2].status='refused';
assert.equal(operatorStats(state,employees[0],'2026-11-11','2026-11-11')[0].awaitingShipment,0);
// A CDEK label or administrator review alone is neither confirmation nor shipment.
state.orders=[order('returned-to-operator',10,{status:'rework'})];assert.equal(operatorStats(state,employees[0],'','')[0].inWork,1);
state.orders[0].confirmedAt='yes';assert.equal(operatorStats(state,employees[0],'','')[0].inWork,0);
state.orders=[order('label',10,{status:'extra',adminReviewedAt:'yes',cdekExported:true,cdekTransferredAt:'yes'})];
const label=operatorStats(state,employees[0],'','')[0];assert.equal(label.confirmed,0);assert.equal(label.sent,0);
state.orders[0].cdekAcceptedAt='yes';assert.equal(operatorStats(state,employees[0],'','')[0].sent,1);
console.log('Operator statistics: six columns, all-order amounts, lifecycle overlap, cohort dates, source deduplication and role scope passed');

const sortable=[{login:'Б',inWork:2,created:2,average:10,amount:20,cancelled:0,confirmed:1,awaitingShipment:0,sent:1},{login:'А',inWork:1,created:10,average:2,amount:20,cancelled:3,confirmed:4,awaitingShipment:2,sent:2}];
for(const key of ['login','created','inWork','average','amount','cancelled','confirmed','awaitingShipment','sent']){
 for(const ascending of [true,false]){
  const sorted=sortOperatorStats(sortable,key,ascending);
  const comparison=key==='login'?sorted[0].login.localeCompare(sorted[1].login,'ru'):sorted[0][key]-sorted[1][key];
  assert.ok(ascending?comparison<=0:comparison>=0);
 }
}
assert.equal(sortable[0].login,'Б');
assert.equal(sortOperatorStats(sortable,'amount',false)[0].login,'А');
console.log('Every statistics column sorts in both directions without mutating rows');

const {mayCallEndpoint}=await import('../lib/permissions.ts');
const statsUrl=new URL('https://crm/api/operator-statistics');
assert.equal(mayCallEndpoint({role:'department_head'},statsUrl,'GET',{}),true);
assert.equal(mayCallEndpoint({role:'department_head'},statsUrl,'POST',{}),false);
assert.equal(mayCallEndpoint({role:'operator'},statsUrl,'GET',{}),false);
console.log('In-work, aggregate-only cross-department summaries and endpoint roles passed');

state.orders=[
 order('lv-buyout',1,{legacyLv:{orderId:'x'},delivery:'cdek_pickup',status:'redeemed',redeemedAt:'2026-11-11T21:00:00Z'}),
 order('post-buyout',1,{delivery:'russian_post',status:'redeemed',redeemedAt:'2026-11-12'}),
 order('moscow-buyout',1,{manager:'b',delivery:'moscow_courier',status:'redeemed',redeemedAt:'2026-11-12T20:59:59Z'}),
 order('unknown-date',1,{delivery:'cdek_pickup',status:'redeemed',paymentReceivedAt:'2026-11-12'}),
 order('old-buyout',1,{delivery:'cdek_pickup',status:'redeemed',redeemedAt:'2026-11-11T20:59:59Z'}),
 order('tomorrow',1,{delivery:'cdek_pickup',status:'redeemed',redeemedAt:'2026-11-12T21:00:00Z'}),
 order('returned',1,{delivery:'cdek_pickup',status:'returned',redeemedAt:'2026-11-12'}),
 order('test',1,{testOnly:true,delivery:'cdek_pickup',status:'redeemed',redeemedAt:'2026-11-12'})
];
state.orders.push({...state.orders[0]});
const buyouts=operatorStats(state,{role:'admin'},'2026-11-12','2026-11-12');
assert.deepEqual(buyouts.map(r=>[r.buyoutCdek,r.buyoutPost,r.buyoutMoscow]),[[1,1,0],[0,0,1]]);
assert.equal(operatorStats(state,{role:'department_head',department:'1'},'2026-11-12','2026-11-12').length,1);
const buyoutSummary=operatorStatsSummary(state,{role:'department_head',department:'1'},'2026-11-12','2026-11-12');
assert.equal(buyoutSummary[1].buyoutMoscow,1);
assert.ok(!JSON.stringify(buyoutSummary).includes('moscow-buyout'));
console.log('Buyouts: actual redemption date, Moscow day, imports, duplicates, test/returned exclusions and department isolation passed');
assert.deepEqual(buyouts.map(r=>[r.created,r.buyoutCount,r.buyoutAmount]),[[0,2,2],[0,1,1]],'Operators with only old orders bought today remain in buyout statistics');
assert.deepEqual(buyouts[0].orderLists.redeemed.map(o=>o.id),['lv-buyout','post-buyout']);
assert.equal(buyoutSummary[1].buyoutCount,1);
assert.equal(buyoutSummary[1].buyoutAmount,1);
for(const key of ['buyoutCount','buyoutAmount','buyoutCdek','buyoutPost','buyoutMoscow']){
 const sorted=sortOperatorStats(buyouts,key,false);assert.ok(sorted[0][key]>=sorted[1][key]);
}
