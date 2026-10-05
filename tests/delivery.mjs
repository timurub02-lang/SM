import assert from 'node:assert/strict';
import {deliverySchema,deliveryLabels} from '../lib/crm.ts';
for(const method of ['cdek_pickup','cdek_courier','moscow_courier','russian_post']){assert.equal(deliverySchema.parse(method),method);assert(deliveryLabels[method]);}
assert.equal(deliverySchema.parse(''),'');
assert(!deliverySchema.safeParse(['cdek_pickup','russian_post']).success);
assert(!deliverySchema.safeParse('unknown').success);
console.log('Delivery selection checks passed');

const {deliveryChangedAfterHandoff,cdekReviewOnDeliveryChange}=await import('../lib/crm.ts');
for(const status of ['confirm','rework','extra','check','packing','phone']){
 const o={status,extra:true,delivery:'russian_post'};
 assert.equal(deliveryChangedAfterHandoff(o,'moscow_courier'),true);
 assert.equal(cdekReviewOnDeliveryChange(o,'cdek_pickup'),['rework','extra','packing','phone'].includes(status));
}
assert.equal(deliveryChangedAfterHandoff({status:'draft',delivery:'russian_post'},'moscow_courier'),false);
assert.equal(deliveryChangedAfterHandoff({status:'confirm',delivery:'cdek_pickup'},'cdek_courier'),false);
assert.equal(cdekReviewOnDeliveryChange({status:'draft',delivery:'russian_post'},'cdek_pickup'),false);
assert.equal(cdekReviewOnDeliveryChange({status:'extra',delivery:'cdek_pickup'},'cdek_courier'),false);
console.log('Delivery channel marker and review boundaries passed');
