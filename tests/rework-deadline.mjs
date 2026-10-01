import assert from 'node:assert/strict';
import {reworkDeadlineFrom,validateReworkCall,reworkTimeLeft,validateTransition} from '../lib/crm.ts';
const at='2026-09-30T10:00:00Z',deadline=reworkDeadlineFrom(at);
assert.equal(deadline,'2026-10-04T10:00:00.000Z');
const order={status:'rework',reworkDeadline:deadline};
assert.doesNotThrow(()=>validateReworkCall(order,deadline));
assert.throws(()=>validateReworkCall(order,'2026-10-04T10:00:01Z'),/4 суток/);
assert.doesNotThrow(()=>validateReworkCall({status:'confirm',reworkDeadline:deadline},'2026-10-05T10:00:00Z'));
assert.equal(reworkTimeLeft(deadline,Date.parse(at)),'4 д 0 ч 0 мин');
assert.equal(reworkTimeLeft(deadline,Date.parse(deadline)),'Срок истёк — отмена заказа');
assert.throws(()=>validateTransition({...order,reworkDeadline:'2000-01-01T00:00:00Z'},'confirm',{},''),/истёк/);
console.log('Four-day deadline and call limits passed');

const {reworkStage}=await import('../lib/crm.ts');
const now=Date.parse(at);
assert.equal(reworkStage({contact:'none',reworkDeadline:deadline},now),'new');
assert.equal(reworkStage({contact:'missed',reworkDeadline:deadline},now),'missed');
assert.equal(reworkStage({contact:'callback',reworkDeadline:deadline},now),'callback');
for(const contact of ['none','missed','callback']){
 assert.equal(reworkStage({contact,reworkDeadline:deadline},Date.parse(deadline)-86400000),'expiring');
}
assert.equal(reworkStage({contact:'callback',reworkDeadline:deadline},Date.parse(deadline)-86400001),'callback');

assert.equal(reworkStage({extra:true,contact:'none'},Date.now()),'extra_new');
assert.equal(reworkStage({extra:true,contact:'callback'},Date.now()),'extra_callback');
assert.equal(reworkStage({extra:true,contact:'missed',reworkDeadline:new Date(Date.now()+3600000).toISOString()},Date.now()),'extra_expiring');
