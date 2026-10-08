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

const {allowedOrderTransitions,validateTransition,orderDatesForTransition,packingStage}=await import('../lib/crm.ts');
const {authorizeCrm}=await import('../lib/permissions.ts');
const post={id:'post-test',clientId:'client',manager:'operator',delivery:'russian_post',status:'shipping',contact:'none',due:'',items:[],createdAt:new Date().toISOString()};
for(const status of ['shipping','pickup']){
 const order={...post,status};
 for(const role of ['logistic','chief_logistic','admin']){
  const actor={id:role,role};
  assert.deepEqual(allowedOrderTransitions(order,role),['redeemed','returned']);
  for(const to of ['redeemed','returned']){
   authorizeCrm(actor,{action:'transition',id:order.id,to},{orders:[order],clients:[],employees:[actor]});
   validateTransition(order,to,{},to==='returned'?'Клиент отказался':'',role);
  }
  for(const reason of ['', '   '])assert.throws(()=>validateTransition(order,'returned',{},reason,role),/причину/);
 }
 for(const role of ['operator','department_head','courier','redemption'])assert.equal(allowedOrderTransitions(order,role).includes('returned'),false);
}
for(const delivery of ['cdek_pickup','cdek_courier','moscow_courier']){
 const order={...post,delivery};
 assert.equal(allowedOrderTransitions(order,'logistic').includes('returned'),false);
 assert.throws(()=>authorizeCrm({id:'l',role:'logistic'},{action:'transition',id:order.id,to:'returned'},{orders:[order],clients:[],employees:[]}));
}
const returned={...post,status:'returned',...orderDatesForTransition(post,'returned',post.createdAt)};
assert.equal(returned.returnedAt,post.createdAt);
assert.equal(packingStage(returned),'returned');
assert.equal(packingStage({...returned,warehouseReturnedAt:post.createdAt}),'warehouse_returned');
assert.deepEqual(allowedOrderTransitions(returned,'logistic'),[]);
console.log('Russian Post: manual paid/return actions, reasons, roles and warehouse stages passed');
