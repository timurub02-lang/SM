import assert from 'node:assert/strict';
import {validateTransition,deliverySchema} from '../lib/crm.ts';
const base={status:'draft',address:'Address',items:[{name:'Product',quantity:1,price:1}]};
for(const [status,extra,to] of [['draft',false,'confirm'],['rework',false,'confirm'],['rework',true,'extra']]){
 const order={...base,status,extra};
 for(const delivery of ['',undefined,['cdek_pickup','russian_post']])assert.throws(()=>validateTransition({...order,delivery},to,{},''),/доставки/);
 for(const delivery of ['cdek_pickup','cdek_courier','moscow_courier','russian_post'])assert.doesNotThrow(()=>validateTransition({...order,delivery},to,{},''));
}
assert.equal(deliverySchema.safeParse(['cdek_pickup','russian_post']).success,false);
assert.doesNotThrow(()=>validateTransition(base,'refused',{},'Reason'));
console.log('Delivery selection required for handoff; single method only');

const {orderMissingField}=await import('../lib/crm.ts');
assert.equal(orderMissingField({...base,items:[]},{}).field,'delivery');
assert.equal(orderMissingField({...base,delivery:'russian_post',items:[]},{}).field,'basket');
assert.equal(orderMissingField({...base,delivery:'russian_post',address:''},{}).field,'address');
assert.equal(orderMissingField({...base,delivery:'russian_post'},{}),null);
