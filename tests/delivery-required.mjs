import assert from 'node:assert/strict';
import {validateTransition,deliverySchema} from '../lib/crm.ts';
const base={createdAt:new Date().toISOString(),status:'draft',address:'Москва, ул. Тестовая, дом 1',items:[{name:'Product',quantity:1,price:1}]};
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

const {itemsSchemaFor}=await import('../lib/crm.ts');
const freeItems=[{name:'Товар',quantity:2,price:0},{name:'ИТОГО',quantity:1,price:0}];
for(const role of ['admin','operator','department_head','logistic']){
 const allowed=role==='admin';
 assert.equal(itemsSchemaFor(allowed).safeParse(freeItems).success,allowed);
 const send=()=>validateTransition({...ready,items:freeItems},'confirm',{name:'Иванов Иван'},'',role);
 if(allowed)assert.doesNotThrow(send);else assert.throws(send,/сумму/);
}
for(const items of [[],[{name:'ИТОГО',quantity:1,price:0}],[{name:'Товар',quantity:0,price:0}],[{name:'Товар',quantity:1,price:-1}]]){
 assert.throws(()=>validateTransition({...ready,items},'confirm',{name:'Иванов Иван'},'','admin'));
}
console.log('Only admin may save and hand off zero total; required goods and quantities remain enforced');

for(const delivery of ['cdek_courier','moscow_courier']){
 for(const status of ['draft','rework','confirm','check']){
  const to=status==='draft'||status==='rework'?'confirm':status==='confirm'?'check':'packing';
  for(const addressParts of [undefined,{postalCode:'393765',region:'Тамбовская область',city:'Мичуринск',street:'ул 7 Ноября',house:'',flat:''}]){
   const o={...base,status,delivery,address:'Мичуринск, ул 7 Ноября',addressParts};
   assert.equal(orderMissingField(o,{name:'Test Client'}).field,'address');
   for(const role of ['operator','department_head','admin','logistic'])assert.throws(()=>validateTransition(o,to,{name:'Test Client'},'',role),/номер дома/);
  }
 }
 assert.equal(orderMissingField({...base,delivery,addressParts:{postalCode:'',region:'',city:'Москва',street:'Тестовая',house:'74',flat:''}},{name:'Test Client'}),null,'Private house needs no flat');
 assert.equal(orderMissingField({...base,delivery,addressParts:{postalCode:'',region:'',city:'Москва',street:'Тестовая',house:'',flat:'15'}},{name:'Test Client'}).field,'address','A flat is not a house');
}
assert.equal(orderMissingField({...base,delivery:'cdek_pickup',address:'Глазов'},{name:'Test Client'}),null);
console.log('Courier house is required for every handoff role and existing check/packing transitions; street digits and flat do not pass; private houses and PVZ remain valid');
