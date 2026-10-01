import assert from 'node:assert/strict';
import {deliverySchema,deliveryLabels} from '../lib/crm.ts';
for(const method of ['cdek_pickup','cdek_courier','moscow_courier','russian_post']){assert.equal(deliverySchema.parse(method),method);assert(deliveryLabels[method]);}
assert.equal(deliverySchema.parse(''),'');
assert(!deliverySchema.safeParse(['cdek_pickup','russian_post']).success);
assert(!deliverySchema.safeParse('unknown').success);
console.log('Delivery selection checks passed');
