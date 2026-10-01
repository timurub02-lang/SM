import assert from 'node:assert/strict';
import {orderEditingLocked} from '../lib/crm.ts';
for(const role of ['operator','logistic','department_head','redemption']) assert.equal(orderEditingLocked({id:'a',role},{status:'check',manager:'a'}),true);
assert.equal(orderEditingLocked({id:'a',role:'admin'},{status:'check',manager:'a'}),false);
for(const status of ['confirm','extra','packing']) assert.equal(orderEditingLocked({id:'a',role:'logistic'},{status,manager:'a'}),false);
console.log('Check stage permissions passed');
