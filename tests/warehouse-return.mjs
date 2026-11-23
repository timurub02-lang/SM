import assert from 'node:assert/strict';
import {legacyReturnItems,canReceiveWarehouseReturn} from '../lib/warehouse-return.ts';
const order={status:'returned',delivery:'russian_post',legacyLv:{trial:false},items:[{name:'ИТОГО',quantity:1,price:100},{name:' Test ',quantity:2,price:0},{name:'test',quantity:1,price:0}]};
assert.deepEqual(legacyReturnItems(order,[{id:'p',name:'Test'}]),[{productId:'p',quantity:3}]);
const mixedNames={...order,items:[{name:' АГАННОН ',quantity:2},{name:'Аганон',quantity:1}]};
const catalog=[{id:'p',name:'Аганон'}];
assert.deepEqual(legacyReturnItems(mixedNames,catalog),[{productId:'p',quantity:3}]);
assert.throws(()=>legacyReturnItems(mixedNames,[...catalog,{id:'q',name:'Аганон'}]),/однозначный/);
assert.throws(()=>legacyReturnItems({...order,items:[{name:'Аганннон',quantity:1}]},catalog),/однозначный/);
for(const role of ['admin','logistic','chief_logistic'])assert.equal(canReceiveWarehouseReturn(order,role),true);
for(const role of ['operator','courier'])assert.equal(canReceiveWarehouseReturn(order,role),false);
for(const patch of [{warehouseReturnedAt:'2026-11-14'},{status:'shipping'},{legacyLv:{trial:true}},{delivery:'cdek_courier'}])assert.equal(canReceiveWarehouseReturn({...order,...patch},'logistic'),false);
assert.throws(()=>legacyReturnItems(order,[]),/Test/);
assert.throws(()=>legacyReturnItems(order,[{id:'p',name:'Test',blocked:true}]),/ЛВ/);
assert.throws(()=>legacyReturnItems({...order,items:[{name:'Test',quantity:0}]},[{id:'p',name:'Test'}]),/количество/);
assert.throws(()=>legacyReturnItems({...order,items:[{name:'ИТОГО',quantity:1}]},[]),/нет товаров/);
console.log('Physical legacy returns: quantities, catalog, blocked sync, total row, roles and lifecycle passed');

assert(canReceiveWarehouseReturn({...order,delivery:'cdek_pickup',cdekReturn:{verifiedAt:'2026-11-16'}},'logistic'));
