import assert from 'node:assert/strict';
import {canOpenClientCard,seesOrder,authorizeCrm} from '../lib/permissions.ts';
import {orderEditingLocked} from '../lib/crm.ts';
for(const role of ['operator','logistic','department_head','redemption']) assert.equal(orderEditingLocked({id:'a',role},{status:'check',manager:'a'}),true);
assert.equal(orderEditingLocked({id:'a',role:'admin'},{status:'check',manager:'a'}),false);
for(const status of ['confirm','extra','packing']) assert.equal(orderEditingLocked({id:'a',role:'logistic'},{status,manager:'a'}),false);
console.log('Check stage permissions passed');

const operator={id:'seller',role:'operator'};
const previousOrder={id:'old-order',clientId:'customer',manager:operator.id,status:'redeemed'};
assert.equal(canOpenClientCard(operator,{owner:operator.id}),true);
for(const owner of ['', 'another-seller']){
 const client={id:'customer',owner};
 assert.equal(canOpenClientCard(operator,client),false);
 assert.equal(seesOrder(operator,previousOrder,[]),true,'Past order remains available');
 for(const action of ['updateClient','createOrder'])assert.throws(()=>authorizeCrm(operator,{action,id:client.id,clientId:client.id},{clients:[client],orders:[previousOrder],employees:[operator]}),/Недостаточно прав/);
}
assert.equal(canOpenClientCard(operator,undefined),false);
for(const role of ['admin','department_head','logistic','chief_logistic'])assert.equal(canOpenClientCard({id:'staff',role},{owner:''}),true);
console.log('Client card: assigned access, released/reassigned denial, order visibility and mutation guards passed');

const {canReviewOrders,reviewRole}=await import('../lib/order-review-access.ts');
const {mayCallEndpoint}=await import('../lib/permissions.ts');
const {filteredOrderList}=await import('../lib/crm-order-list.ts');
const {employeeTasks}=await import('../lib/reminder-tasks.ts');
const reviewer={id:'E-74ee9a8f-99d',role:'department_head',department:'1'};
const otherHead={...reviewer,id:'other-head',login:'SKP_Artem'};
const staff=[reviewer,otherHead,{id:'foreign',role:'operator',department:'2'}];
const check={id:'review',clientId:'foreign-client',manager:'foreign',status:'check',contact:'none',items:[],updatedAt:new Date().toISOString()};
const state={employees:staff,clients:[{id:check.clientId,owner:'foreign',name:'Test',phone:'',city:''}],orders:[check,{...check,id:'held',zvd:{by:'admin'}},{...check,id:'shipping',status:'shipping'}],events:[],settings:{retentionDays:30}};
assert.equal(canReviewOrders(reviewer),true);
assert.equal(canReviewOrders(otherHead),false,'Login alone must not transfer delegation');
assert.equal(canReviewOrders({...reviewer,role:'operator'}),false);
assert.equal(seesOrder(reviewer,check,staff),true);
assert.equal(seesOrder(otherHead,check,staff),false);
assert.equal(seesOrder(reviewer,state.orders[2],staff),false);
assert.equal(orderEditingLocked(reviewer,check),false);
assert.equal(reviewRole(reviewer,check),'admin');
assert.equal(reviewRole(reviewer,state.orders[2]),'department_head');
for(const action of ['transition','markZvd','markPV','markBlacklist','comment']){
 assert.doesNotThrow(()=>authorizeCrm(reviewer,{action,id:check.id},state));
 assert.throws(()=>authorizeCrm(otherHead,{action,id:check.id},state));
 assert.throws(()=>authorizeCrm(reviewer,{action,id:'shipping'},state));
}
assert.throws(()=>authorizeCrm(reviewer,{action:'updateSettings'},state));
const query={view:'check',filter:'all',query:'',showNextPremium:false};
assert.deepEqual(filteredOrderList(state,reviewer,query).map(o=>o.id),['review']);
assert.deepEqual(filteredOrderList(state,reviewer,{...query,filter:'zvd'}).map(o=>o.id),['held']);
assert.deepEqual(filteredOrderList(state,otherHead,query),[]);
assert.deepEqual(employeeTasks(state,reviewer).map(t=>t.orderId),['review']);
for(const method of ['GET','POST']){
 assert.equal(mayCallEndpoint({role:'chief_logistic'},new URL('https://crm.test/api/cdek/routing'),method,{}),true);
 for(const role of ['logistic','department_head','operator'])assert.equal(mayCallEndpoint({role},new URL('https://crm.test/api/cdek/routing'),method,{}),false);
}
assert.equal(mayCallEndpoint({role:'logistic'},new URL('https://crm.test/api/cdek/routing?orderId=x'),'GET',{}),true);
console.log('Delegated review and chief-logistic routing permissions passed');
