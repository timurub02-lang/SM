import assert from 'node:assert/strict';
import {validateTransition,deliverySchema} from '../lib/crm.ts';
const base={createdAt:new Date().toISOString(),status:'draft',address:'Address',items:[{name:'Product',quantity:1,price:1}]};
for(const [status,extra,to] of [['draft',false,'confirm'],['rework',false,'confirm'],['rework',true,'extra']]){
 const order={...base,status,extra};
 for(const delivery of ['',undefined,['cdek_pickup','russian_post']])assert.throws(()=>validateTransition({...order,delivery},to,{name:'Тестовый Клиент'},''),/доставки/);
 for(const delivery of ['cdek_pickup','cdek_courier','moscow_courier','russian_post'])assert.doesNotThrow(()=>validateTransition({...order,delivery},to,{name:'Тестовый Клиент'},''));
}
assert.equal(deliverySchema.safeParse(['cdek_pickup','russian_post']).success,false);
assert.doesNotThrow(()=>validateTransition(base,'refused',{},'Reason'));
console.log('Delivery selection required for handoff; single method only');

const {orderMissingField}=await import('../lib/crm.ts');
assert.equal(orderMissingField({...base,items:[]},{name:"Тестовый Клиент"}).field,'delivery');
assert.equal(orderMissingField({...base,delivery:'russian_post',items:[]},{name:"Тестовый Клиент"}).field,'basket');
assert.equal(orderMissingField({...base,delivery:'russian_post',address:''},{name:"Тестовый Клиент"}).field,'address');
assert.equal(orderMissingField({...base,delivery:'russian_post'},{name:"Тестовый Клиент"}),null);

const ready={...base,delivery:'russian_post'};
for(const name of [undefined,'','   ','Неизвестный клиент']){
 assert.equal(orderMissingField(ready,{name,address:''}).field,'name');
 assert.throws(()=>validateTransition(ready,'confirm',{name,address:''},'','operator'),/ФИО/);
}
for(const items of [[],[{name:'ИТОГО',quantity:1,price:9000}],[{name:'Товар',quantity:0,price:9000}],[{name:'Товар',quantity:1,price:0}],[{name:'Товар',quantity:1,price:0},{name:'ИТОГО',quantity:1,price:0}]]){
 assert.throws(()=>validateTransition({...ready,items},'confirm',{name:'Иванов Иван'},'','operator'));
}
for(const role of ['operator','department_head','admin']){
 const items=[{name:'Товар',quantity:2,price:0},{name:'ИТОГО',quantity:1,price:9000}];
 assert.doesNotThrow(()=>validateTransition({...ready,items},'confirm',{name:'Иванов Иван'},'',role));
 assert.throws(()=>validateTransition({...ready,address:'  ',items},'confirm',{name:'Иванов Иван',address:'Другой адрес'},'',role),/адрес/);
}
console.log('Handoff requires client name, saved address, goods, quantity and positive total; zero-priced goods with ИТОГО remain valid');
