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
assert.equal(packingStage({delivery:'moscow_courier',manualDeliveryCost:0}),'calculated');
assert.equal(packingStage({delivery:'russian_post',manualDeliveryCost:300,packingWaybillAt:'2026-09-30'}),'waybill');
assert.equal(packingStage({delivery:'russian_post',manualDeliveryCost:300,status:'returned'}),'returned');
console.log('Delivery queues and manual delivery calculation passed');
