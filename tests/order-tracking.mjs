import assert from 'node:assert/strict';
import {orderTracking} from '../lib/order-tracking.ts';
assert.equal(orderTracking({delivery:'cdek_pickup'}),null);
assert.equal(orderTracking({delivery:'russian_post',legacyLv:{track:'123'}}),null);
assert.equal(orderTracking({delivery:'cdek_courier',legacyLv:{track:' 123 '}}).number,'123');
const t=orderTracking({delivery:'cdek_pickup',cdekTrackingNumber:'456',legacyLv:{track:'123'}});
assert.equal(t.number,'456');assert.equal(t.url,'https://www.cdek.ru/ru/tracking/?order_id=456');
assert.equal(new URL(orderTracking({delivery:'cdek_pickup',cdekTrackingNumber:'12&test=1'}).url).searchParams.get('order_id'),'12&test=1');
console.log('Tracking: source priority, carriers, missing numbers and safe URL passed');
