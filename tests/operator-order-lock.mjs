import assert from 'node:assert/strict';
import {orderEditingLocked} from '../lib/crm.ts';
for(const status of ['draft','rework','confirm','packing','shipping','redeemed']){
 assert(orderEditingLocked({id:'one',role:'department_head'},{manager:'one',status}));
 assert.equal(orderEditingLocked({id:'one',role:'operator'},{manager:'one',status}),!['draft','rework'].includes(status));
 assert(orderEditingLocked({id:'one',role:'operator'},{manager:'other',status}));
 for(const role of ['logistic','admin','redemption'])assert(!orderEditingLocked({id:'one',role},{manager:'other',status}));
}
console.log('Order editing role restrictions passed');
