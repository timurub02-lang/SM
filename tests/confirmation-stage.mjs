import assert from 'node:assert/strict';
import {confirmationStage} from '../lib/crm.ts';
const now=Date.parse('2026-10-01T10:00:00Z');
const order={status:'confirm',contact:'none',finalHandoffAt:'2026-09-30T16:00:00Z',noAnswerDeadline:new Date(now+6*3600000).toISOString()};
for(const contact of ['none','missed','callback']) {
 assert.equal(confirmationStage({...order,contact},now),'expiring');
 assert.equal(confirmationStage({...order,contact},now-1),contact==='none'?'new':contact);
}
assert.equal(confirmationStage({...order,status:'extra'},now),'repeat_expiring');
assert.equal(confirmationStage({...order,status:'extra'},now-1),'repeat');
assert.equal(confirmationStage({...order,noAnswerDeadline:undefined},now),'expiring');
assert.equal(confirmationStage({...order,finalHandoffAt:undefined},now),'new');
console.log('Confirmation expiry grouping passed');

assert.equal(confirmationStage({...order,status:'extra',contact:'missed'},now-1),'repeat_missed');
assert.equal(confirmationStage({...order,status:'extra',contact:'callback'},now-1),'repeat_callback');

const {nextExtraConfirmationAt,confirmationDeadline}=await import('../lib/crm.ts');
for(const [at,expected] of [['2026-11-16T05:00:00Z','2026-11-17T06:00:00.000Z'],['2026-11-16T21:00:00Z','2026-11-18T06:00:00.000Z'],['2026-12-31T20:59:59Z','2027-01-01T06:00:00.000Z']])assert.equal(nextExtraConfirmationAt(at),expected);
const due=nextExtraConfirmationAt('2026-11-16T09:00:00Z');
const scheduled={status:'extra',contact:'callback',due,extraCallbackAt:due,confirmationStartedAt:due,confirmationHours:48,timerCalendar:'weekdays-v1'};
assert.equal(confirmationStage(scheduled,Date.parse(due)-1),'repeat_callback');
assert.equal(confirmationStage(scheduled,Date.parse(due)),'repeat');
assert.equal(confirmationStage({...scheduled,extraCallbackAt:undefined},Date.parse(due)),'repeat_callback','Ordinary callbacks keep their existing behavior');
assert.equal(confirmationStage({...scheduled,contact:'missed'},Date.parse(due)),'repeat_missed');
assert.equal(confirmationDeadline(scheduled),'2026-11-19T06:00:00.000Z');
console.log('Admin repeat confirmation: tomorrow 09:00 Moscow, exact boundary and deadline from scheduled time passed');
