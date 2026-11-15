import assert from 'node:assert/strict';
import {orderCurrentStatusLabel,orderDisplayGroup,orderDisplayGroups,showOrderInList} from '../lib/order-premium-stage.ts';
import {orderGroup,closedOrderCallBlocked} from '../lib/crm.ts';
assert.deepEqual(orderDisplayGroups.slice(orderDisplayGroups.findIndex(g=>g.id==='paid'),orderDisplayGroups.findIndex(g=>g.id==='paid')+3).map(g=>g.label),['Оплачен','Начислено','Выплачено']);
const order={status:'redeemed'};
assert.equal(orderDisplayGroup(order).id,'paid');
for(const [status,id] of [['accrued','accrued'],['paid','premium_paid']]){
 const o={...order,premiumStage:{status,periodId:'2026-10-2'}};
 assert.equal(orderDisplayGroup(o).id,id);
 assert.equal(orderGroup(o).id,'paid');
 assert.equal(closedOrderCallBlocked({id:'operator',role:'operator'},o,{owner:''}),true);
}
assert.equal(orderDisplayGroup({...order,premiumStage:{status:'accrued',periodId:''}}).id,'paid');
assert.equal(orderDisplayGroup({status:'returned',premiumStage:{status:'paid',periodId:'2026-10-2'}}).id,'returned');
console.log('Financial tabs preserve order lifecycle and call restrictions');

const paidOrder={status:'redeemed',manager:'original',premiumStage:{status:'paid',periodId:'2026-10-2'}};
for(const role of ['operator','department_head']){
 assert.equal(showOrderInList(paidOrder,{owner:'original'},role),false);
 for(const client of [{owner:''},{owner:'other'},undefined])assert.equal(showOrderInList(paidOrder,client,role),false);
 assert.equal(showOrderInList({...paidOrder,premiumStage:{status:'accrued',periodId:'2026-10-2'}},{owner:''},role),true);
 assert.equal(showOrderInList({...paidOrder,premiumStage:undefined},{owner:''},role),true);
}
assert.equal(showOrderInList(paidOrder,{owner:''},'admin'),false);
assert.equal(paidOrder.premiumStage.status,'paid');

const cancelled={status:'refused',manager:'original',cancelledAt:'2026-10-28T10:00:00Z',cancellationAuthor:{id:'original',name:'Operator'}};
const saved=JSON.stringify(cancelled);
for(const role of ['admin','operator','department_head']){
 assert.equal(showOrderInList(cancelled,{owner:'original'},role),true);
 assert.equal(showOrderInList(cancelled,{owner:''},role),false);
 assert.equal(showOrderInList(cancelled,{owner:'other'},role),false);
}
assert.equal(showOrderInList(cancelled,{owner:''},'logistic'),true);
assert.equal(showOrderInList({...cancelled,status:'returned'},{owner:''},'admin'),false);
assert.equal(showOrderInList({...paidOrder,premiumStage:{status:'accrued',periodId:'2026-10-2'}},{owner:''},'admin'),true);
assert.equal(JSON.stringify(cancelled),saved);
assert.equal(orderGroup(cancelled).id,'cancelled');

const {cdekMoneyLabel}=await import('../lib/cdek-remittance.ts');
const imported={status:'redeemed',delivery:'',importedPayment:{source:'История выплат · 2026-10-1'}};
assert.equal(cdekMoneyLabel(imported),'Деньги получены · История выплат · 2026-10-1');
assert.equal(cdekMoneyLabel({...imported,status:'refused'}),'');
assert.equal(cdekMoneyLabel({...imported,importedPayment:undefined}),'');

for(const role of ['operator','department_head'])assert.equal(showOrderInList({status:'rework',manager:'original'},{owner:'original'},role),false);
assert.equal(showOrderInList({status:'rework',manager:'original'},{owner:'original'},'admin'),true);

assert.equal(showOrderInList(paidOrder,{owner:'original'},'admin'),false);
assert.equal(showOrderInList(paidOrder,{owner:'other'},'admin'),false);

assert.equal(orderCurrentStatusLabel({status:'redeemed'}),'Оплачен');
assert.equal(orderCurrentStatusLabel({status:'redeemed',premiumStage:{status:'accrued',periodId:'2026-11-1'}}),'Начислено');
assert.equal(orderCurrentStatusLabel({status:'redeemed',premiumStage:{status:'paid',periodId:'2026-11-1'}}),'Выплачено');
assert.equal(orderCurrentStatusLabel({status:'extra'}),'Доп. подтверждение');

const {paidOrderArchived}=await import('../lib/order-premium-stage.ts');
const {filteredOrderList}=await import('../lib/crm-order-list.ts');
const paidAt='2026-11-20T12:00:00Z',deadline=Date.parse(paidAt)+48*3600000;
const fresh={...paidOrder,id:'paid-delay',clientId:'client',createdAt:paidAt,items:[],delivery:'moscow_courier',priorPremiumPaid:{at:'2026-11-01T00:00:00Z'},premiumStage:{status:'paid',periodId:'2026-11-2',paidAt}};
const savedPaid=JSON.stringify(fresh);
for(const role of ['admin','operator','department_head','logistic','chief_logistic']){
 assert.equal(showOrderInList(fresh,{owner:''},role,deadline-1),true);
 assert.equal(showOrderInList(fresh,{owner:'original'},role,deadline),false);
}
assert.equal(paidOrderArchived({...fresh,premiumStage:{status:'accrued',periodId:'2026-11-2'}},deadline),false);
assert.equal(paidOrderArchived({...fresh,status:'returned'},deadline),false);
assert.equal(paidOrderArchived({...fresh,premiumStage:{status:'paid',periodId:'2026-11-1',paidAt:'2026-11-15T20:00:00Z'}},Date.parse('2026-11-15T21:31:00Z')),true);
for(const [view,delivery] of [['orders','moscow_courier'],['moscow','moscow_courier'],['post','russian_post']]){
 const state={clients:[{id:'client',name:'Client',phone:'',city:'',owner:'original'}],employees:[],orders:[{...fresh,delivery}],settings:{orderPolicy:{}}};
 const q={view,filter:'all',query:'',showNextPremium:false};
 assert.equal(filteredOrderList(state,{id:'admin',role:'admin'},q,deadline-1).length,1);
 assert.equal(filteredOrderList(state,{id:'admin',role:'admin'},q,deadline).length,0);
 assert.equal(state.orders.length,1);
}
assert.equal(JSON.stringify(fresh),savedPaid);
console.log('Paid order archive: immediate historical hide, 48h boundary, all roles, orders/Moscow/Post, no data mutation passed');

const {returnedOrderHidden}=await import('../lib/order-premium-stage.ts');
const returned={status:'returned',warehouseReturnedAt:'2026-11-16T10:00:00Z'};
const returnDeadline=Date.parse(returned.warehouseReturnedAt)+48*3600000;
for(const delivery of ['cdek_pickup','cdek_courier','moscow_courier','russian_post']){
 for(const role of ['admin','operator','department_head'])assert.equal(returnedOrderHidden({...returned,delivery},role,returnDeadline-1),true);
 for(const role of ['logistic','chief_logistic']){
  assert.equal(returnedOrderHidden({...returned,delivery},role,returnDeadline-1),false);
  assert.equal(returnedOrderHidden({...returned,delivery},role,returnDeadline),true);
  assert.equal(returnedOrderHidden({...returned,delivery,warehouseReturnedAt:undefined},role,returnDeadline),false);
 }
}
assert.equal(returnedOrderHidden({status:'rework'},'operator',returnDeadline),false,'clarification is not warehouse return');
assert.equal(returnedOrderHidden({status:'refused',delivery:'moscow_courier',courier:{acceptedAt:'2026-11-15'}},'admin',returnDeadline),true);
assert.equal(orderDisplayGroup(returned).id,'returned','history status unchanged');
console.log('Returned orders: roles, all delivery methods, exact 48-hour boundary and history passed');
