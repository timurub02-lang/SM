import assert from 'node:assert/strict';
import {operatorReturnLabel,allowedOrderTransitions,finalNoAnswerDeadline,validateTransition} from '../lib/crm.ts';
const now='2026-10-01T10:00:00Z';
const o={status:'confirm',finalHandoffAt:now,address:'Address',items:[{name:'Product',quantity:1,price:1}]};
assert.deepEqual(allowedOrderTransitions(o),['check','refused']);
assert.deepEqual(allowedOrderTransitions({...o,status:'extra'}),['packing','refused']);
assert(allowedOrderTransitions({...o,finalHandoffAt:undefined}).includes('rework'));
assert.throws(()=>validateTransition(o,'rework',{},'Reason'),/недоступен/);
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
 assert(!allowedOrderTransitions(afterReturn,'logistic').includes('rework'));
 assert.doesNotThrow(()=>validateTransition(afterReturn,'refused',{},'Refusal','logistic'));
}
assert(allowedOrderTransitions({...o,status:'extra',finalHandoffAt:undefined},'admin').includes('refused'));
console.log('Return labels and stage-specific logistic cancellation permissions passed');
