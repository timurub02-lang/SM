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

for(const role of ['operator','department_head']){
 const actor={id:role==='operator'?'original':'head',role,department:'sales'};
 const staff=[{id:'original',role:'operator',department:'sales'},actor];
 const c={id:'client',owner:''},o={...paidOrder,id:'order',clientId:c.id,premiumStage:{status:'accrued',periodId:'current'}};
 const {authorizeCrm}=await import('../lib/permissions.ts');
 const {assignedClients}=await import('../lib/crm.ts');
 assert.deepEqual(assignedClients([c],staff,actor),[]);
 assert.equal(showOrderInList(o,c,role),true);
 assert.equal(closedOrderCallBlocked(actor,o,c),true);
 assert.throws(()=>authorizeCrm(actor,{action:'comment',id:o.id},{orders:[o],clients:[c],employees:staff}));
 assert.equal(showOrderInList({...o,premiumStage:{status:'paid',periodId:'current',paidAt:new Date().toISOString()}},c,role),false);
}

const cancelled={status:'refused',manager:'original',cancelledAt:'2026-10-28T10:00:00Z',cancellationAuthor:{id:'original',name:'Operator'}};
const saved=JSON.stringify(cancelled);
for(const role of ['admin','operator','department_head']){
 assert.equal(showOrderInList(cancelled,{owner:'original'},role),false);
 assert.equal(showOrderInList(cancelled,{owner:''},role),false);
 assert.equal(showOrderInList(cancelled,{owner:'other'},role),false);
}
assert.equal(showOrderInList(cancelled,{owner:''},'logistic'),false);
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
 assert.equal(showOrderInList(fresh,{owner:''},role,deadline-1),!['operator','department_head'].includes(role));
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
assert.equal(returnedOrderHidden({status:'refused',delivery:'moscow_courier',courier:{acceptedAt:'2026-11-15'}},'admin',returnDeadline),false);
assert.equal(orderDisplayGroup(returned).id,'returned','history status unchanged');
console.log('Returned orders: roles, all delivery methods, exact 48-hour boundary and history passed');

const {operationalOrderHidden}=await import('../lib/order-premium-stage.ts');
const cancelDeadline=Date.parse(cancelled.cancelledAt)+24*3600000;
for(const role of ['admin','operator','department_head','logistic','chief_logistic','courier'])for(const owner of ['','original','other'])for(const blacklistedAt of [undefined,cancelled.cancelledAt]){
 const o={...cancelled,blacklistedAt};
 assert.equal(showOrderInList(o,{owner},role,cancelDeadline-1),true);
 assert.equal(showOrderInList(o,{owner},role,cancelDeadline),false);
 assert.equal(operationalOrderHidden(o,role,cancelDeadline),true);
}
assert.equal(operationalOrderHidden({...cancelled,delivery:'moscow_courier',courier:{acceptedAt:cancelled.cancelledAt}},'logistic',cancelDeadline),false);
console.log('Cancelled orders: visible 24 hours regardless of ownership/blacklist; warehouse receipt preserved');

// Delivery workspaces give administrators the same warehouse-return window as logistics.
for(const [view,delivery] of [['moscow','moscow_courier'],['post','russian_post'],['shipping','cdek_pickup'],['shipping','cdek_courier']]){
 const order={id:'returned-workspace',clientId:'client',manager:'original',createdAt:returned.warehouseReturnedAt,items:[],...returned,delivery};
 const state={clients:[{id:'client',name:'Test',phone:'',city:''}],employees:[],orders:[order],settings:{orderPolicy:{}}};
 const q={view,filter:'warehouse_returned',query:'',showNextPremium:false};
 for(const role of ['admin','logistic','chief_logistic']){
  assert.equal(filteredOrderList(state,{id:role,role},q,returnDeadline-1).length,1,view+' '+role+' before archive');
  assert.equal(filteredOrderList(state,{id:role,role},q,returnDeadline).length,0,view+' '+role+' after archive');
  const awaiting={...state,orders:[{...order,warehouseReturnedAt:undefined}]};
  assert.equal(filteredOrderList(awaiting,{id:role,role},{...q,filter:'returned'},returnDeadline).length,1,view+' '+role+' awaiting receipt');
 }
 assert.equal(filteredOrderList(state,{id:'admin',role:'admin'},{...q,view:'orders',filter:'all'},returnDeadline-1).length,0,'general order archive unchanged');
}
console.log('Admin delivery returns: Moscow/Post/CDEK match logistics until receipt +48h; general order archive unchanged');

const refusedParcel={id:'physical-return',clientId:'client',manager:'original',status:'refused',delivery:'moscow_courier',createdAt:'2026-11-01T00:00:00Z',cancelledAt:'2026-11-01T00:00:00Z',items:[],courier:{acceptedAt:'2026-11-01T00:00:00Z'}};
for(const role of ['admin','logistic','chief_logistic'])assert.equal(filteredOrderList({clients:[{id:'client',name:'Test'}],employees:[],orders:[refusedParcel],settings:{orderPolicy:{}}},{id:role,role},{view:'moscow',filter:'returned',query:'',showNextPremium:false},returnDeadline).length,1,'physical courier return remains visible until receipt');
