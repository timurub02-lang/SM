import assert from 'node:assert/strict';
import {packingStage} from '../lib/crm.ts';
assert.equal(packingStage({}),'new');
assert.equal(packingStage({cdekTariff:{code:136}}),'calculated');
assert.equal(packingStage({cdekTariff:{code:136},packingWaybillAt:'2026-09-30T00:00:00Z'}),'waybill');
console.log('Packing stages passed');

assert.equal(packingStage({cdekExported:true,cdekTariff:{},packingWaybillAt:"2026-09-30"}),"exported");
assert.equal(packingStage({cdekExported:false,cdekTariff:{}}),"calculated");

assert.equal(packingStage({status:'returned',cdekExported:true,cdekTariff:{},packingWaybillAt:'2026-09-30'}),'returned');
assert.equal(packingStage({status:'returned',warehouseReturnedAt:'2026-09-30',cdekExported:true}),'warehouse_returned');
assert.equal(packingStage({status:'returned'}),'returned');
assert.equal(packingStage({status:'shipping',cdekExported:true}),'exported');
console.log('Return tabs override export and calculation stages');

const {deliveryQueue}=await import('../lib/crm.ts');
for(const [delivery,queue] of [['moscow_courier','moscow'],['russian_post','post'],['cdek_pickup','shipping'],['cdek_courier','shipping'],['','shipping']]){
 for(const view of ['moscow','post','shipping'])assert.equal(deliveryQueue({delivery},view),queue===view);
}
assert.equal(packingStage({delivery:'moscow_courier',manualDeliveryCost:0}),'new');
assert.equal(packingStage({delivery:'russian_post',manualDeliveryCost:300,packingWaybillAt:'2026-09-30'}),'waybill');
assert.equal(packingStage({delivery:'russian_post',manualDeliveryCost:300,status:'returned'}),'returned');
console.log('Delivery queues and manual delivery calculation passed');

for(const delivery of ['moscow_courier','russian_post']){
 assert.equal(packingStage({delivery,manualDeliveryCost:300}),'new');
 assert.equal(packingStage({delivery,cdekTariff:{}}),'new');
 assert.equal(packingStage({delivery,packingWaybillAt:'2026-10-02'}),'waybill');
}

const {allowedOrderTransitions,orderDatesForTransition,orderGroup}=await import('../lib/crm.ts');
for(const delivery of ['moscow_courier','russian_post']){
 const o={delivery,status:'packing'};
 assert.deepEqual(allowedOrderTransitions(o,'logistic'),[]);
 assert.deepEqual(allowedOrderTransitions({...o,packingWaybillAt:'2026-10-02'},'logistic'),['shipping']);
 assert.deepEqual(allowedOrderTransitions({...o,packingWaybillAt:'2026-10-02'},'operator'),[]);
 assert.equal(packingStage({...o,status:'shipping',packingWaybillAt:'2026-10-02'}),'exported');
 assert.deepEqual(allowedOrderTransitions({...o,status:'shipping'},'logistic'),delivery==='russian_post'?['redeemed','returned']:[]);
 assert.equal(orderDatesForTransition(o,'shipping','2026-10-02').shippedAt,'2026-10-02');
 assert.equal(orderGroup('shipping').id,'sent');
}

const {canReceivePayment}=await import('../lib/crm.ts');
for(const delivery of ['moscow_courier','russian_post']){
 const paid={status:'redeemed',delivery};
 assert.equal(packingStage(paid),'paid');
 assert.equal(packingStage({...paid,paymentReceivedAt:'2026-10-02'}),'payment_received');
 assert(canReceivePayment(paid,'chief_logistic'));
 assert(!canReceivePayment(paid,'operator'));
 assert(!canReceivePayment({...paid,paymentReceivedAt:'2026-10-02'},'logistic'));
 assert.equal(orderGroup(paid.status).id,'paid');
}
assert.deepEqual(allowedOrderTransitions({status:'shipping',delivery:'russian_post'},'logistic'),['redeemed','returned']);
assert.deepEqual(allowedOrderTransitions({status:'shipping',delivery:'moscow_courier'},'logistic'),[]);
