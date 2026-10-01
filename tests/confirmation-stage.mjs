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
assert.equal(confirmationStage({...order,noAnswerDeadline:undefined},now),'new');
assert.equal(confirmationStage({...order,finalHandoffAt:undefined},now),'new');
console.log('Confirmation expiry grouping passed');

assert.equal(confirmationStage({...order,status:'extra',contact:'missed'},now-1),'repeat_missed');
assert.equal(confirmationStage({...order,status:'extra',contact:'callback'},now-1),'repeat_callback');
