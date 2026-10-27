import assert from 'node:assert/strict';
import {returnCountdown} from '../lib/return-countdown.ts';
const now=Date.parse('2026-10-27T12:00:00Z');
assert.equal(returnCountdown('2026-10-27T14:00:00Z',undefined,now),'Осталось 2 ч 0 мин');
assert.equal(returnCountdown('2026-10-27T12:00:01Z',undefined,now),'Осталось 1 мин');
assert.equal(returnCountdown('2026-10-27T12:00:00Z',undefined,now),'Время истекло');
assert.equal(returnCountdown('2026-10-27T15:00:00Z','2026-10-27T13:00:00Z',now),'До начала: 1 ч 0 мин');
assert.equal(returnCountdown('invalid',undefined,now),'Срок не указан');
console.log('Return countdown: active, scheduled, expiry and invalid deadline passed');
