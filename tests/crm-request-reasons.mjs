import assert from 'node:assert/strict';
import {activeOrderReason,skOrderReview} from '../lib/sk-order-review.ts';
const orders=[{id:'SK-1',clientId:'c',status:'shipping'},{id:'SM-2',clientId:'c',status:'packing'},{id:'old',clientId:'c',status:'redeemed'},{id:'other',clientId:'other',status:'shipping'}];
const reason=activeOrderReason(orders,'c');
assert.equal(reason,'Есть действующие заказы: SK-1 — Отправлен, SM-2 — Принят');
assert.equal(skOrderReview('p',{id:'op'},{id:'c',owner:'op',source:'',sheet:'К'},{id:'op'},orders).reasons[0],reason);
assert.equal(activeOrderReason(orders,'missing'),undefined);
assert.ok(!reason.includes('Проекта'));assert.ok(!reason.includes('другому'));
console.log('CRM request reasons share SK active order numbers/statuses, exclude closed/other clients and never infer SK-specific causes.');
