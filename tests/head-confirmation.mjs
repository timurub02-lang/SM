import assert from 'node:assert/strict';
import {headConfirmationTarget,confirmByHead,canHeadRequestEdit} from '../lib/head-confirmation.ts';
import {pickupPointContext} from '../lib/order-pickup-point.ts';
const at=new Date().toISOString(),e={id:'head',name:'Head',role:'department_head',department:'1'},staff=[{id:'op',role:'operator',department:'1'}],c={name:'Test Client',address:'125009, Москва, Тверская, дом 1'};
const base={id:'test',clientId:'client',manager:'op',status:'rework',returnKind:'clarification',returnReason:'Fix address',delivery:'moscow_courier',address:c.address,items:[{name:'Product',quantity:1,price:100}],round:1,contact:'none',extra:false,createdAt:at,updatedAt:at};
for(const delivery of ['moscow_courier','russian_post','cdek_courier','cdek_pickup']){
 const o={...base,delivery};if(delivery==='cdek_pickup')o.cdekPickupPoint={code:'TEST',address:'PVZ',workTime:'',context:pickupPointContext(o)};
 assert.equal(confirmByHead(o,c,e,staff,at,true,true).status,delivery!=='moscow_courier'?'check':'packing');
 assert.throws(()=>confirmByHead(o,c,e,staff,at,true,false),/замечаний/);
 for(const status of ['confirm','extra']){
  const missed={...o,status,contact:'missed',returnKind:undefined};assert.ok(headConfirmationTarget(missed));assert.equal(headConfirmationTarget({...missed,contact:'callback'}),undefined);
 }
}
for(const fields of [{courier:{}},{courierRecall:{}},{shippedAt:at},{cdekTransferredAt:at},{cdekExported:true},{cdekDeleting:true},{packingReworkDelivery:'moscow_courier'},{zvd:true},{cancellationRequest:{status:'pending'}},{editRequest:{status:'pending'}},{editRequest:{status:'editing'}}])assert.equal(headConfirmationTarget({...base,...fields}),undefined);
assert.throws(()=>confirmByHead(base,c,{...e,department:'other'},staff,at,true,true),/отделу/);
assert.throws(()=>confirmByHead(base,c,e,staff,at,false,true),/согласие/);
assert.throws(()=>confirmByHead({...base,address:''},{...c,address:''},e,staff,at,true,true),/адрес/);
assert.throws(()=>confirmByHead({...base,reworkDeadline:'2000-01-01T00:00:00Z'},c,e,staff,at,true,true),/истёк/);
assert.equal(canHeadRequestEdit(e,{...base,status:'confirm'},staff),true);
assert.equal(base.status,'rework');console.log('Head confirmation: routing, remarks, consent, ownership, saved edits and shipment boundaries passed.');

const savedPending={...base,editRequest:{id:'r',status:'pending',from:'confirm',reason:'Correct amount',savedAt:at}};
assert.equal(confirmByHead(savedPending,c,e,staff,at,true,true).editRequest.status,'completed');

for(const from of ['check','packing']){
 const editing={...base,editRequest:{id:'r',status:'editing',from,reason:'Correct amount',savedAt:at}};
 assert.equal(confirmByHead(editing,c,e,staff,at,true,true).status,from);
}
