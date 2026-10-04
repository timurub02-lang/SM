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
