import assert from 'node:assert/strict';
import {money,stamp} from '../lib/crm.ts';
const oldMoney=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(n);
for(const n of [0,-0,1,-1,0.004,0.005,1.005,-1.005,9999999.99,NaN,Infinity,-Infinity])assert.equal(money(n),oldMoney(n));
for(const timeZone of [undefined,'Europe/Moscow','UTC','America/New_York','Asia/Vladivostok']){
 for(const value of ['', 'not a date','2026-10-31T21:30:00Z','2026-03-08T06:59:00Z','2026-03-08T07:01:00Z','2026-11-01T05:59:00Z','2026-11-01T06:01:00Z']){
  const expected=value?new Date(value).toLocaleString('ru-RU',{timeZone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
  assert.equal(stamp(value,timeZone),expected);
 }
}
assert.throws(()=>stamp('2026-01-01T00:00:00Z','Not/AZone'),RangeError);
assert.throws(()=>stamp('2026-01-01T00:00:00Z',''),RangeError);
console.log('Display formats preserve currency rounding, empty/invalid dates, time zones and DST boundaries.');
