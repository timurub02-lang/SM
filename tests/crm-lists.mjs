import assert from 'node:assert/strict';
import {seed} from '../lib/crm.ts';
import {filteredOrderList} from '../lib/crm-order-list.ts';
import {filteredClientList} from '../lib/crm-client-list.ts';
const state=seed(),now=Date.parse('2026-11-12T00:30:00Z'),at=new Date(now).toISOString();
const employee={id:'operator',role:'operator',department:'1'};state.employees=[employee];
state.clients=[{id:'one',name:'Иван',phone:'',city:'Москва',owner:'operator',createdAt:at},{id:'two',name:'Другой',phone:'',city:'',owner:'other',createdAt:at}];
const order={id:'O-123',clientId:'one',manager:'operator',status:'draft',items:[],createdAt:at,updatedAt:at,contact:'callback',due:'2026-11-11T23:30:00Z',reason:'',comment:'',round:0};
state.orders=[order,{...order,id:'O-456',clientId:'two',manager:'other'}];
assert.deepEqual(filteredOrderList(state,employee,{view:'orders',filter:'cancelled',query:'123',showNextPremium:false},now).map(o=>o.id),['O-123'],'search crosses status tabs, retaining ownership');
assert.equal(filteredOrderList(state,employee,{view:'orders',filter:'cancelled',query:'',showNextPremium:false},now).length,0);
assert.deepEqual(filteredClientList(state,employee,{filter:'today',query:'',clientWorkFilter:'all',timeZone:'Europe/Moscow'},now).map(c=>c.id),['one']);
assert.equal(filteredClientList(state,employee,{filter:'today',query:'',clientWorkFilter:'all',timeZone:'UTC'},now).length,0,'server must use the browser calendar day');
assert.equal(filteredClientList(state,employee,{filter:'all',query:'O-123',clientWorkFilter:'all'},now).length,1,'client search includes order IDs');
console.log('List selectors: cross-tab search, ownership and browser calendar boundaries passed');

state.orders=Array.from({length:65},(_,i)=>({...order,id:'SORT-'+i,createdAt:new Date(now+i*60000).toISOString(),items:[{name:'Товар',quantity:1,price:65-i}]}));
const query={view:'orders',filter:'new',query:'',showNextPremium:false};
assert.equal(filteredOrderList(state,employee,query,now)[0].id,'SORT-64','newest first across the complete list');
assert.equal(filteredOrderList(state,employee,{...query,direction:'asc'},now)[0].id,'SORT-0');
assert.equal(filteredOrderList(state,employee,{...query,sort:'total',direction:'desc'},now)[0].id,'SORT-0');
assert.equal(filteredOrderList(state,employee,{...query,sort:'id',direction:'asc'},now)[10].id,'SORT-10','numeric order identifiers');
assert.equal(filteredOrderList(state,employee,query,now).slice(50)[0].id,'SORT-14','pagination happens after sorting');
state.redemptionStatuses=['READY_FOR_PICKUP'];
state.orders=[{...order,id:'older-action',status:'shipping',delivery:'cdek_courier',createdAt:'2026-11-01T00:00:00Z',cdekStatus:{code:'READY_FOR_PICKUP'}},{...order,id:'newer-waiting',status:'shipping',delivery:'cdek_courier',cdekStatus:{code:'CREATED'}}];
assert.equal(filteredOrderList(state,employee,{...query,filter:'sent'},now)[0].id,'older-action','keep sent orders needing work above waiting orders');
console.log('Order sorting: descending dates, directions, amount, natural IDs, pagination and redemption priority passed');

const {orderStageDate}=await import('../lib/order-stage-date.ts');
state.orders=[{...order,id:'old-created',status:'redeemed',createdAt:'2020-01-01',redeemedAt:'2026-11-12'},{...order,id:'new-created',status:'redeemed',createdAt:'2026-11-01',redeemedAt:'2026-11-10'},{...order,id:'missing',status:'redeemed'}];
assert.deepEqual(filteredOrderList(state,employee,{...query,filter:'paid'}).map(o=>o.id),['old-created','new-created','missing']);
assert.deepEqual(filteredOrderList(state,employee,{...query,filter:'paid',direction:'asc'}).map(o=>o.id),['new-created','old-created','missing']);
for(const [status,field,label] of [['draft','createdAt','Создан'],['confirm','confirmationStartedAt','Передан'],['packing','confirmedAt','Принят'],['shipping','shippedAt','Отправлен'],['redeemed','redeemedAt','Оплачен'],['refused','cancelledAt','Отменён'],['returned','returnedAt','Возврат']]){
 assert.deepEqual(orderStageDate({...order,status,[field]:at}),{label,at});
}
assert.equal(orderStageDate({...order,status:'redeemed',redeemedAt:'bad'}).at,undefined);
assert.equal(orderStageDate({...order,status:'redeemed',priorPremiumPaid:{at,source:'import'}}).at,undefined,'import time is not historical payout time');
assert.equal(orderStageDate({...order,status:'redeemed',premiumStage:{status:'paid',periodId:'2026-11-1',paidAt:at}}).at,at);
assert.equal(orderStageDate({...order,status:'redeemed',premiumStage:{status:'accrued',periodId:'2026-11-1'},paymentReceivedAt:at}).at,at);
console.log('Stage dates: lifecycle mapping, unknown dates and ascending/descending order passed');

const {orderStageDateLabel}=await import('../lib/order-stage-date.ts');
assert.equal(orderStageDateLabel({...order,status:'redeemed',redeemedAt:'2026-11-12'}),'Оплачен: 12.11.2026');

for(const role of ['operator','department_head']){
 const viewer={...employee,role};
 for(const filter of ['expires','in_transit','without_orders']){
  assert.deepEqual(filteredClientList(state,viewer,{filter,query:' Иван ',clientWorkFilter:'callback'},now).map(c=>c.id),['one']);
  assert.equal(filteredClientList(state,viewer,{filter,query:'Другой',clientWorkFilter:'all'},now).length,0,'search must not expose other operators/departments');
 }
}
assert.equal(filteredClientList(state,employee,{filter:'expires',query:'   ',clientWorkFilter:'all'},now).length,0,'empty query retains filters');

// Explicit blacklist review keeps the cancelled order in its operator's list after release.
state.clients=[{id:'one',name:'Иван',phone:'',city:'',owner:'',createdAt:at}];
state.orders=[{...order,status:'refused',blacklistedAt:at}];
for(const role of ['operator','department_head'])assert.equal(filteredOrderList(state,{...employee,role},{...query,filter:'cancelled'},now).length,1);

state.clients=Array.from({length:65},(_,i)=>({id:'client-'+i,name:'Клиент '+String(i).padStart(2,'0'),phone:'',city:'',owner:'operator',createdAt:at}));
state.clients.push({id:'foreign',name:'А чужой',owner:'other',phone:'',city:'',createdAt:at});
state.orders=state.clients.flatMap((c,i)=>[{...order,id:'paid-'+i,clientId:c.id,status:'redeemed',items:[{name:'Товар',price:i,quantity:2}]},{...order,id:'return-'+i,clientId:c.id,status:'returned',items:[{name:'Товар',price:9999-i,quantity:1}]}]);
for(const role of ['operator','department_head']){
 const viewer={...employee,role},q={filter:'all',query:'',clientWorkFilter:'all'};
 for(const clientSort of ['name','amount'])for(const direction of ['asc','desc']){
  const rows=filteredClientList(state,viewer,{...q,clientSort,direction},now);
  assert.equal(rows.length,65);assert.equal(rows[0].id,direction==='asc'?'client-0':'client-64');
  assert.equal(rows.slice(50)[0].id,direction==='asc'?'client-50':'client-14','sort complete results before pagination');
 }
 assert.equal(filteredClientList(state,viewer,{...q,query:'Клиент 05',clientSort:'amount',direction:'desc'},now)[0].id,'client-5');
}
console.log('Client sorting: both roles, name/paid amount/directions, search and pagination passed');

// Manual column sorting must not be partitioned by worked/pending flags inside the 15 eligible orders.
state.clients=[{id:'one',name:'Иван',phone:'',city:'',owner:'operator',createdAt:at}];
state.redemptionStatuses=['NOT_DELIVERED','ACCEPTED_AT_PICK_UP_POINT'];
state.orders=Array.from({length:25},(_,i)=>({...order,id:'SENT-'+i,contact:'none',status:'shipping',delivery:'cdek_courier',shippedAt:new Date(now+i*60000).toISOString(),items:[{name:'Товар',quantity:1,price:25-i}],cdekStatus:{code:i<15?(i%2?'NOT_DELIVERED':'ACCEPTED_AT_PICK_UP_POINT'):'CREATED'}}));
state.redemptionResults=Object.fromEntries(state.orders.map((o,i)=>[o.id,{workedToday:i%3===0,awaitingOperator:i===7,result:'',date:'',author:'',at:''}]));
for(const role of ['operator','department_head'])for(const sort of ['stageDate','createdAt','id','client','status','location','action','total','manager'])for(const direction of ['asc','desc']){
 const q={...query,filter:'sent',sort,direction,manualSort:true},viewer={...employee,role};
 const actual=filteredOrderList(state,viewer,q,now);
 const expected=filteredOrderList({...state,redemptionResults:{}},viewer,q,now);
 assert.deepEqual(actual.map(o=>o.id),expected.map(o=>o.id),`${role}/${sort}/${direction}: hidden worked/pending flags must not override selected column`);
 assert.equal(actual.length,25);
 assert.ok(actual.slice(0,15).every(o=>o.cdekStatus.code!=='CREATED'));
 if(sort==='total')assert.equal(actual[0].id,direction==='asc'?'SENT-14':'SENT-0');
 if(sort==='stageDate')assert.equal(actual[0].id,direction==='asc'?'SENT-0':'SENT-14');
}
assert.equal(filteredOrderList(state,employee,{...query,filter:'sent'},now)[0].id,'SENT-7','default view keeps pending-operator priority');
console.log('Sent 15/25: all column directions, both roles, eligibility priority and default pending priority passed');
