import assert from 'node:assert/strict';
import {authorizeCrm,visibleState} from '../lib/permissions.ts';
const order={id:'o',clientId:'c',manager:'op',status:'shipping',delivery:'moscow_courier',courier:{id:'courier'},logisticComment:'Позвонить за час',items:[]};
const state={orders:[order],clients:[{id:'c',owner:'op'}],employees:[],events:[],incoming:[],settings:{}};
for(const role of ['admin','logistic','chief_logistic'])assert.doesNotThrow(()=>authorizeCrm({id:role,role},{action:'updateLogisticComment',id:'o'},state));
for(const role of ['operator','department_head','redemption','courier','purchasing'])assert.throws(()=>authorizeCrm({id:role==='operator'?'op':role,role},{action:'updateLogisticComment',id:'o'},state));
assert.throws(()=>authorizeCrm({id:'l',role:'logistic'},{action:'updateLogisticComment',id:'missing'},state));
assert.equal(visibleState(state,{id:'courier',role:'courier'}).orders[0].logisticComment,order.logisticComment);
assert.equal(visibleState(state,{id:'another',role:'courier'}).orders.length,0);
for(const delivery of ['cdek_pickup','cdek_courier','russian_post']){
 const s={...state,orders:[{...order,delivery,courier:undefined}]};
 assert.equal(visibleState(s,{id:'l',role:'logistic'}).orders[0].logisticComment,order.logisticComment);
 assert.equal(visibleState(s,{id:'courier',role:'courier'}).orders.length,0);
}
console.log('Logistic comment: writing roles, assigned courier visibility and delivery access passed');
