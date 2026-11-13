import assert from 'node:assert/strict';
import {operatorReturnLabel,allowedOrderTransitions,finalNoAnswerDeadline,validateTransition} from '../lib/crm.ts';
const now='2026-10-01T10:00:00Z';
const o={status:'confirm',finalHandoffAt:now,address:'Москва, ул. Тестовая, дом 1',items:[{name:'Product',quantity:1,price:1}]};
assert.deepEqual(allowedOrderTransitions(o),['check','rework','refused']);
assert.deepEqual(allowedOrderTransitions({...o,status:'extra'}),['packing','rework','refused']);
assert(allowedOrderTransitions({...o,finalHandoffAt:undefined}).includes('rework'));
assert.doesNotThrow(()=>validateTransition(o,'rework',{},'Reason','logistic','clarification'));
assert.throws(()=>validateTransition(o,'rework',{},'Reason','logistic','refusal'),/уже отрабатывался/);
assert.doesNotThrow(()=>validateTransition(o,'refused',{},'Refusal'));
assert.throws(()=>validateTransition(o,'refused',{},''),/причину/);
const deadline=finalNoAnswerDeadline(o,'missed',now);
assert.equal(deadline,'2026-10-02T10:00:00.000Z');
assert.equal(finalNoAnswerDeadline({...o,noAnswerDeadline:deadline},'missed','2026-10-02T09:00:00Z'),deadline);
assert.equal(finalNoAnswerDeadline({...o,noAnswerDeadline:deadline},'callback',now),deadline);
assert.equal(finalNoAnswerDeadline({...o,finalHandoffAt:undefined},'missed',now),undefined);
assert.equal(finalNoAnswerDeadline({...o,status:'pickup'},'missed',now),undefined);
console.log('Final handoff restrictions and no-answer deadline passed');

assert.equal(finalNoAnswerDeadline(o,'callback',now),deadline);

assert.equal(finalNoAnswerDeadline(o,'none',now),deadline);
assert.equal(finalNoAnswerDeadline(o,'callback','2026-10-02T09:00:00Z'),deadline);
assert.equal(finalNoAnswerDeadline({...o,noAnswerDeadline:'2026-10-03T10:00:00Z'},'none',now),deadline);

assert.deepEqual(allowedOrderTransitions({...o,status:'extra',finalHandoffAt:undefined}),['packing','rework','refused']);
assert.deepEqual(allowedOrderTransitions({...o,status:'rework',extra:true,finalHandoffAt:undefined}),['extra','refused']);

assert.equal(operatorReturnLabel({round:1}),'');
assert.equal(operatorReturnLabel({round:2}),'После 1-го возврата оператору');
assert.equal(operatorReturnLabel({round:3}),'После 2-го возврата оператору');
for(const status of ['confirm','extra']){
 const initial={...o,status,round:2,finalHandoffAt:undefined};
 assert(!allowedOrderTransitions(initial,'logistic').includes('refused'));
 assert(allowedOrderTransitions(initial,'logistic').includes('rework'));
 assert.throws(()=>validateTransition(initial,'refused',{},'Refusal','logistic'));
 const afterReturn={...initial,finalHandoffAt:now};
 assert(allowedOrderTransitions(afterReturn,'logistic').includes('refused'));
 assert(allowedOrderTransitions(afterReturn,'logistic').includes('rework'));
 assert.doesNotThrow(()=>validateTransition(afterReturn,'refused',{},'Refusal','logistic'));
}
assert(allowedOrderTransitions({...o,status:'extra',finalHandoffAt:undefined},'admin').includes('refused'));
console.log('Return labels and stage-specific logistic cancellation permissions passed');

for(const delivery of ['moscow_courier','russian_post']){
 const first={...o,delivery,finalHandoffAt:undefined};
 const target=delivery==='moscow_courier'?'packing':'extra';
 assert.deepEqual(allowedOrderTransitions(first,'logistic'),[target,'rework']);
 assert.deepEqual(allowedOrderTransitions({...first,finalHandoffAt:now},'logistic'),[target,'rework','refused']);
 assert.throws(()=>validateTransition(first,'check',{},'','logistic'));
 assert.doesNotThrow(()=>validateTransition(first,target,{},'','logistic'));
}
assert.deepEqual(allowedOrderTransitions({...o,delivery:'cdek_pickup',finalHandoffAt:undefined},'logistic'),['check','rework']);
console.log('Manual delivery bypasses admin review; CDEK retains review.');

const {reworkHandoff}=await import('../lib/crm.ts');
const {defaultOrderPolicy}=await import('../lib/order-policy.ts');
let clarification={...o,status:'rework',round:1,returnKind:'clarification',finalHandoffAt:undefined};
for(let i=0;i<5;i++){
 clarification={...clarification,...reworkHandoff(clarification,now,defaultOrderPolicy)};
 assert.equal(clarification.round,1);assert.equal(clarification.finalHandoffAt,undefined);
 assert.equal(clarification.confirmationHours,defaultOrderPolicy.confirmationHours);
 assert(allowedOrderTransitions({...clarification,status:'confirm'},'logistic').includes('rework'));
}
const final={...clarification,...reworkHandoff({...clarification,returnKind:'refusal'},now,defaultOrderPolicy),status:'confirm'};
assert.equal(final.round,2);assert.equal(final.finalHandoffAt,now);
assert(allowedOrderTransitions(final,'logistic').includes('rework'));
assert.equal(final.refusalHandoffAt,now);
assert.throws(()=>validateTransition({...final,finalHandoffAt:undefined},'rework',{},'Отказ','logistic','refusal'),/уже отрабатывался/);
assert(allowedOrderTransitions(final,'logistic').includes('refused'));
assert.equal(reworkHandoff({...clarification,extra:true},now,defaultOrderPolicy).confirmationHours,defaultOrderPolicy.extraConfirmationHours);
assert.equal(reworkHandoff({...clarification,returnKind:undefined},now,defaultOrderPolicy).finalHandoffAt,now,'Legacy returns preserve their existing final handoff policy');
console.log('Five clarification cycles do not consume refusal handoff; refusal and legacy restrictions preserved.');

for(const delivery of ['cdek_pickup','cdek_courier','russian_post','moscow_courier']){
 const packing={...o,status:'packing',delivery,extra:true,packingWaybillAt:now,shippedAt:undefined,cdekExported:false};
 assert(allowedOrderTransitions(packing,'logistic').includes('rework'));
 assert(allowedOrderTransitions({...packing,finalHandoffAt:now},'logistic').includes('refused'));
 assert(!allowedOrderTransitions({...packing,cdekExported:true},'logistic').includes('rework'));
 if(delivery==='moscow_courier')assert(!allowedOrderTransitions({...packing,courierRecall:{completedAt:now}},'logistic').includes('rework'));
 const reconfirm={...packing,status:'confirm',packingReworkDelivery:delivery,finalHandoffAt:undefined,extra:false,returnKind:'refusal'};
 assert.deepEqual(allowedOrderTransitions(reconfirm,'logistic'),['packing','rework']);
 assert.deepEqual(allowedOrderTransitions({...reconfirm,finalHandoffAt:now},'logistic'),['packing','rework','refused']);
 assert(!allowedOrderTransitions({...reconfirm,delivery:'cdek_courier',packingReworkDelivery:'russian_post'},'logistic').includes('packing'));
}
assert.throws(()=>validateTransition({...o,status:'rework',returnKind:'delivery',delivery:'cdek_pickup'},'confirm',{name:'Тестовый клиент'},'','operator'),/Согласуйте/);
console.log('Packing returns allow one reconfirmation for unchanged or manual delivery; exported orders and changed CDEK routes stay guarded.');

const {canLogisticEditBasket}=await import('../lib/crm.ts');
for(const status of ['packing','phone']){
 const editable={status,delivery:'cdek_courier'};
 assert(canLogisticEditBasket(editable));
 for(const guard of [{cdekExported:true},{cdekDeleting:true},{shippedAt:now},{courier:{id:'courier'}}])assert(!canLogisticEditBasket({...editable,...guard}));
}
for(const status of ['draft','confirm','extra','check','shipping','redeemed','returned'])assert(!canLogisticEditBasket({status,delivery:'cdek_courier'}));

assert.equal(reworkHandoff({...clarification,packingReworkDelivery:"cdek_courier",finalHandoffAt:now},now,defaultOrderPolicy).finalHandoffAt,now);
