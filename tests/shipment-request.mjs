import assert from 'node:assert/strict';
import {requestShipment,resolveShipment,shippedOrder} from '../lib/shipment-request.ts';
const op={id:'op',name:'Operator',role:'operator'},log={id:'log',name:'Logistic',role:'logistic'},red={id:'red',name:'Redemption',role:'redemption'};
for(const delivery of ['cdek_pickup','cdek_courier','russian_post','moscow_courier']){
 const o={id:'o',clientId:'c',manager:'op',status:'shipping',delivery,shippedAt:'sent',items:[{name:'Item',quantity:1,price:100}],address:'Original address'};
 for(const kind of ['return','change']){
  const pending=requestShipment(o,op,kind,'Customer request','incoming','request','now'),key=kind==='return'?'shipmentReturn':'shipmentChange';
  assert.equal(pending.status,'shipping');assert.deepEqual(pending.items,o.items);assert.equal(pending.address,o.address);assert.equal(pending[key].status,'pending');
  assert.throws(()=>requestShipment(pending,op,kind,'Again','incoming','other','now'));
  assert.throws(()=>resolveShipment(pending,op,kind,'request','done','Done','now'));
  const actor=kind==='return'&&delivery.startsWith('cdek_')?red:log;
  for(const decision of ['done','failed']){const result=resolveShipment(pending,actor,kind,'request',decision,'Carrier reply','now');assert.equal(result.status,'shipping');assert.equal(result.shippedAt,'sent');assert.equal(result[key].status,decision);assert.equal(result.manager,'op');assert.equal(result.address,'Original address');}
  assert.throws(()=>resolveShipment(pending,actor,kind,'request','done',' ','now'));
 }
}
for(const status of ['draft','confirm','packing','redeemed','refused','returned'])assert.equal(shippedOrder({status}),false);
console.log('Shipment requests: carrier-specific routing, explicit replies, no physical return or content changes, required reasons, repeated/closed guards passed');
