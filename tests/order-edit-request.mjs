import assert from 'node:assert/strict';
import {beforeShipment,requestOrderEdit,resolveOrderEdit,completeOrderEdit,handoffEditRequest} from '../lib/order-edit-request.ts';
const op={id:'op',name:'Operator',role:'operator'},log={id:'log',name:'Logistic',role:'logistic'};
for(const status of ['draft','confirm','extra','check','packing','phone']){
 const o={id:'o',status,manager:'op',items:[{name:'Item',price:100,quantity:1}],confirmationStartedAt:'2026-11-14T08:00:00Z',packingWaybillAt:'prior-waybill'};
 const requested=requestOrderEdit(o,op,'Correct address','in','req','now');assert.equal(requested.status,status);assert.equal(requested.editRequest.status,'pending');
 assert.throws(()=>resolveOrderEdit(requested,op,'req','edit','','now'));
 const editing=resolveOrderEdit(requested,log,'req','edit','','now');assert.equal(editing.status,'rework');assert.equal(editing.returnKind,'clarification');assert.equal(editing.manager,'op');
 assert.throws(()=>completeOrderEdit(editing,op,'req','now'));
 const done=completeOrderEdit({...editing,editRequest:{...editing.editRequest,savedAt:'saved'}},op,'req','done');assert.equal(done.status,status);assert.equal(done.confirmationStartedAt,o.confirmationStartedAt);assert.equal(done.manager,'op');assert.equal(done.editRequest.status,'completed');assert.equal(done.packingWaybillAt,o.packingWaybillAt);
 assert.throws(()=>requestOrderEdit(editing,op,'again','in','other','now'));
}
for(const patch of [{status:'shipping'},{status:'pickup'},{status:'redeemed'},{shippedAt:'sent'},{courier:{id:'c'}},{cdekTransferredAt:'sent'}]){
 const o={id:'o',manager:'op',status:'confirm',...patch};assert.equal(beforeShipment(o),false);assert.throws(()=>requestOrderEdit(o,op,'edit','in','req','now'));
}
const pending=requestOrderEdit({id:'o',status:'confirm'},op,'edit','in','r','now');assert.throws(()=>resolveOrderEdit(pending,log,'wrong','edit','','now'));assert.throws(()=>resolveOrderEdit(pending,log,'r','reject',' ','now'));
assert.equal(resolveOrderEdit({...pending,status:'shipping'},log,'r','reject','Already shipped','now').editRequest.status,'rejected');
console.log('Pre-shipment edit request: explicit logistics approval, roles, every stage restored, saved edits required, unchanged author/clock, shipped guards and stale requests passed');

const checkRequest=requestOrderEdit({id:'o',status:'check',manager:'op'},op,'Change amount','incoming','check-edit','requested');
const packing={...checkRequest,status:'packing',editRequest:handoffEditRequest(checkRequest,'packing','moved')};
assert.equal(packing.editRequest.status,'pending');assert.equal(packing.editRequest.from,'packing');
assert.equal(resolveOrderEdit(packing,log,'check-edit','edit','','approved').status,'rework');
const rework={...checkRequest,status:'rework',editRequest:{...checkRequest.editRequest,savedAt:'saved'}};
for(const to of ['confirm','extra','check','packing']){
 assert.equal(handoffEditRequest(rework,to,'done').status,'completed');
 assert.equal(handoffEditRequest(rework,to,'done').completedAt,'done');
 assert.equal(handoffEditRequest({...rework,editRequest:checkRequest.editRequest},to,'done').status,'pending');
}
assert.equal(handoffEditRequest(checkRequest,'packing','moved').at,'requested');
assert.equal(handoffEditRequest(rework,'refused','cancelled').status,'pending');
