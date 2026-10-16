import assert from 'node:assert/strict';
import {allowedResults,dateConfirmedToday,inRedemptionTab,inWorkday} from '../lib/redemption.ts';
const row={entered_at:'2026-10-15T10:00:00Z',result:'date',resultDate:'2026-10-20',dateConfirmation:'confirmed',dateConfirmedAt:'2026-10-16T20:59:59Z'};
assert(dateConfirmedToday(row,'2026-10-16'));
assert(inRedemptionTab(row,'confirm','2026-10-16'));
assert(!inWorkday(row,'2026-10-16'));
assert(!inRedemptionTab(row,'confirm','2026-10-17'));
assert(!inWorkday(row,'2026-10-17'));
assert(inWorkday(row,'2026-10-20'));
assert(!inRedemptionTab(row,'confirm','2026-10-20'));
assert(!dateConfirmedToday({...row,dateConfirmedAt:'2026-10-16T21:00:00Z'},'2026-10-16'));
console.log('Confirmed dates: visible today, hidden tomorrow, due-day return and Moscow boundary passed');

assert.deepEqual(allowedResults('courier',{storageUntil:'2026-10-20'},'operator','2026-10-16'),['courier']);
assert.deepEqual(allowedResults('courier',{storageUntil:'2026-10-15'},'operator','2026-10-16'),[]);
assert.deepEqual(allowedResults('courier',{operatorReturn:{deadline:'2026-10-16T13:00:00Z'}},'operator','2026-10-16'),[]);

const returned={...row,result:'returned',returnConfirmedAt:'2026-10-16T20:59:59Z',returnWaybill:'TEST-123'};assert(inRedemptionTab(returned,'returns','2026-10-16'));assert(!inRedemptionTab(returned,'returns','2026-10-17'));assert(!inWorkday(returned,'2026-10-16'));

assert(!inRedemptionTab({...row,dateVerifiedAt:'2026-10-16T20:59:59Z'},'confirm','2026-10-16'));
assert(inWorkday({...row,dateVerifiedAt:'2026-10-16T20:59:59Z'},'2026-10-20'));
