import assert from 'node:assert/strict';
import {cancellationDetails} from '../lib/order-cancellation.ts';
const order={id:'o',status:'refused',reason:'Отказ клиента',cancelledAt:'2026-10-15T12:00:00Z'};
assert.equal(cancellationDetails({...order,status:'shipping'},[]),null);
assert.equal(cancellationDetails(order,[]).reason,'Отказ клиента');
assert.equal(cancellationDetails({...order,reason:' '},[]).reason,'Причина не указана');
const events=[{orderId:'other',text:'Заказ отменён: срок',actor:'Чужой',at:'2026-10-16'},{orderId:'o',text:'Заказ отменён: срок',actor:'Система',at:order.cancelledAt},{orderId:'o',text:'Комментарий: отмена',actor:'Поздний автор',at:'2026-10-17'}];
assert.equal(cancellationDetails(order,events).author,'Система');
assert.equal(cancellationDetails({...order,cancellationAuthor:{name:'Руководитель',at:'2026-10-15'}},events).author,'Руководитель');
assert.equal(cancellationDetails({...order,cancelledAt:undefined},[]).at,'');
console.log('Cancellation reason, explicit author, system history and missing metadata passed');

const {requestOrderCancellation,resolveOrderCancellation,cancellationBlockReason}=await import('../lib/order-cancellation.ts');
const op={id:'operator',name:'Operator',role:'operator'},logist={id:'log',name:'Logistic',role:'logistic'};
const pending=requestOrderCancellation({id:'cancel',status:'packing',manager:'operator'},op,'Client changed mind','incoming','request','2026-11-01T10:00:00Z');
assert.equal(pending.status,'packing');assert.equal(pending.cancellationRequest.status,'pending');
assert.throws(()=>resolveOrderCancellation(pending,op,'request','cancel','','2026-11-01T10:01:00Z'));
const cancelled=resolveOrderCancellation(pending,logist,'request','cancel','','2026-11-01T10:01:00Z');
assert.equal(cancelled.status,'refused');assert.equal(cancelled.manager,'operator');assert.equal(cancelled.cancellationRequest.decidedBy,'log');
for(const patch of [{cdekExported:true},{cdekTransferredAt:'now'},{cdekDeleting:true},{courier:{id:'courier'}},{shippedAt:'now'},{status:'shipping'},{status:'pickup'},{status:'redeemed'}]){
 assert(cancellationBlockReason({...pending,...patch}));
 assert.throws(()=>resolveOrderCancellation({...pending,...patch},logist,'request','cancel','','now'));
}
assert.throws(()=>resolveOrderCancellation(cancelled,logist,'request','cancel','','now'));
assert.throws(()=>resolveOrderCancellation(pending,logist,'other','cancel','','now'));
assert.throws(()=>resolveOrderCancellation(pending,logist,'request','reject','','now'));
assert.equal(resolveOrderCancellation(pending,logist,'request','reject','Already shipped','now').status,'packing');
