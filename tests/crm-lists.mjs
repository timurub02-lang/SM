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
